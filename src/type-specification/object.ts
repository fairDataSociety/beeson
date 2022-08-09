import { TypeSpecification, Header, TypeDefinitionO } from '.'
import { BeeSon } from '../beeson'
import {
  Type,
  assertBeeSonType,
  serializeType,
  deserializeType,
  SUPER_BEESON_TYPE,
  StorageLoader,
} from '../types'
import { BitVector } from '../bitvector'
import {
  deserializeUint16,
  deserializeUint32,
  serializeUint16,
  serializeUint32,
} from '../marshalling/number-serializer'
import { serializeString } from '../marshalling/string-seralizer'
import {
  Bytes,
  bytesToString,
  flattenBytesArray,
  segmentPaddingFromRight,
  segmentSize,
  SEGMENT_SIZE,
} from '../utils'
import { makeChunkedFile } from '@fairdatasociety/bmt-js'

const OBJECT_TYPE_DEF_LENGTH = 8

type TypeDefElement = Bytes<8>

export function serializeNullableObject(
  typeSpecification: TypeSpecification<Type.nullableObject>,
): Uint8Array {
  // this marker array with be correspond to the typeDefs and superTypeDefs order
  const serializedMarkers = getSerializedMarkers(typeSpecification)
  const typeDefinitions = typeSpecification.typeDefinitions
  const { typeDefArray, superTypeRefArray, bv } = serializeTypeDefinitions(typeDefinitions, serializedMarkers)
  const flattenTypeDefs = flattenBytesArray(typeDefArray)
  const flattenSuperTypeRefs = flattenBytesArray(superTypeRefArray)

  const bytes = new Uint8Array([
    ...serializeUint16(typeDefArray.length),
    ...serializeUint16(superTypeRefArray.length),
    ...serializeUint16(serializedMarkers.serializedMarkers.length),
    ...flattenTypeDefs,
    ...serializedMarkers.serializedMarkers,
    ...bv.bitVector,
  ])

  return new Uint8Array([...segmentPaddingFromRight(bytes), ...flattenSuperTypeRefs])
}

export async function deserializeNullableObject(
  data: Uint8Array,
  header: Header<Type.nullableObject>,
  storageLoader?: StorageLoader,
): Promise<{
  typeSpecificationManager: TypeSpecification<Type.nullableObject>
  typeSpecificationByteSize: number
}> {
  const lengths = deserializeTypeSpecLengths(data)
  const { typeDefArrayLength, superTypeRefArrayLength, markersByteLength } = lengths
  let offset = lengths.offset

  // init bitvector
  const startMarkerByteIndex = offset + typeDefArrayLength * OBJECT_TYPE_DEF_LENGTH
  const starBitVektorByteIndex = startMarkerByteIndex + markersByteLength
  const bitVector = new BitVector(
    typeDefArrayLength,
    data.slice(starBitVektorByteIndex, starBitVektorByteIndex + Math.ceil(typeDefArrayLength / 8)),
  )
  // after bitvector it is padded from right
  const segmentsUntilSuperBeeSonRefs = segmentSize(
    lengths.offset +
      typeDefArrayLength * OBJECT_TYPE_DEF_LENGTH +
      markersByteLength +
      bitVector.bitVector.length,
  )
  const bytesUntilSuperBeeSonRefs = segmentsUntilSuperBeeSonRefs * SEGMENT_SIZE
  const typeSpecificationByteSize = bytesUntilSuperBeeSonRefs + superTypeRefArrayLength * SEGMENT_SIZE // latter is the ref array's length

  // deserialize typedefs
  const typeDefinitions: TypeDefinitionO[] = []
  let i = 0
  let j = 0 // superBeeSon index
  let markerOffset = 0
  while (i < typeDefArrayLength) {
    const type = deserializeType(data.slice(offset, offset + 2) as Bytes<2>)
    const segmentLength = deserializeUint32(data.slice(offset + 2, offset + 6) as Bytes<4>)

    const markerLength = deserializeUint16(data.slice(offset + 6, offset + 8) as Bytes<2>)
    const marker = bytesToString(
      data.slice(startMarkerByteIndex + markerOffset, startMarkerByteIndex + markerOffset + markerLength),
    )
    markerOffset += markerLength

    const nullable = bitVector.getBit(i)

    if (Number(type) === SUPER_BEESON_TYPE) {
      if (!storageLoader) {
        throw new Error(`StorageLoader is not defined`)
      }

      const refOffset = bytesUntilSuperBeeSonRefs + j * SEGMENT_SIZE
      const superTypeRef = data.slice(refOffset, refOffset + SEGMENT_SIZE) as Bytes<32>

      const typeSpecificationData = await storageLoader(superTypeRef)
      const { typeSpecificationManager } = await TypeSpecification.deserialize(
        typeSpecificationData,
        header,
        storageLoader,
      )
      typeSpecificationManager.superBeeSon = true
      typeSpecificationManager.nullable = nullable
      //TODO check `typeSpecificationManager` header is the same as current
      typeDefinitions.push({
        segmentLength,
        beeSon: new BeeSon({ typeSpecificationManager }),
        marker,
      })

      j++
    } else {
      assertBeeSonType(type)

      // if deserialized type is container type, then its typeSpecification has to be deserialized in a different function call
      const typeSpecificationManager = new TypeSpecification(
        header.obfuscationKey,
        header.version,
        type,
        null,
        nullable,
      )
      typeDefinitions.push({
        segmentLength,
        beeSon: new BeeSon({ typeSpecificationManager }),
        marker,
      })
    }

    offset += OBJECT_TYPE_DEF_LENGTH
    i++
  }

  if (j !== superTypeRefArrayLength) {
    throw new Error(
      `There were ${j} superTypeDefintions when it should be exactly ${superTypeRefArrayLength}`,
    )
  }

  return {
    typeSpecificationManager: new TypeSpecification(
      header.obfuscationKey,
      header.version,
      Type.nullableObject,
      typeDefinitions,
    ),
    typeSpecificationByteSize,
  }
}

export async function deserializeObject(
  data: Uint8Array,
  header: Header<Type.object>,
  storageLoader?: StorageLoader,
): Promise<{ typeSpecificationManager: TypeSpecification<Type.object>; typeSpecificationByteSize: number }> {
  const lengths = deserializeTypeSpecLengths(data)
  const { typeDefArrayLength, superTypeRefArrayLength, markersByteLength } = lengths
  let offset = lengths.offset

  // after arrays it is padded from right
  const segmentsUntilSuperBeeSonRefs = segmentSize(
    lengths.offset + typeDefArrayLength * OBJECT_TYPE_DEF_LENGTH + markersByteLength,
  )
  const bytesUntilSuperBeeSonRefs = segmentsUntilSuperBeeSonRefs * SEGMENT_SIZE
  const typeSpecificationByteSize = bytesUntilSuperBeeSonRefs + superTypeRefArrayLength * SEGMENT_SIZE // latter is the ref array's length
  const startMarkerByteIndex = offset + typeDefArrayLength * OBJECT_TYPE_DEF_LENGTH

  // deserialize typedefs
  const typeDefinitions: TypeDefinitionO[] = []
  let i = 0
  let j = 0 // superBeeSon index
  let markerOffset = 0
  while (i < typeDefArrayLength) {
    const type = deserializeType(data.slice(offset, offset + 2) as Bytes<2>)
    const segmentLength = deserializeUint32(data.slice(offset + 2, offset + 6) as Bytes<4>)

    const markerLength = deserializeUint16(data.slice(offset + 6, offset + 8) as Bytes<2>)
    const marker = bytesToString(
      data.slice(startMarkerByteIndex + markerOffset, startMarkerByteIndex + markerOffset + markerLength),
    )
    markerOffset += markerLength

    if (Number(type) === SUPER_BEESON_TYPE) {
      if (!storageLoader) {
        throw new Error(`StorageLoader is not defined`)
      }

      const refOffset = bytesUntilSuperBeeSonRefs + j * SEGMENT_SIZE
      const superTypeRef = data.slice(refOffset, refOffset + SEGMENT_SIZE) as Bytes<32>
      const typeSpecificationData = await storageLoader(superTypeRef)
      const { typeSpecificationManager } = await TypeSpecification.deserialize(
        typeSpecificationData,
        undefined,
        storageLoader,
      )
      typeSpecificationManager.superBeeSon = true
      //TODO check `typeSpecificationManager` header is the same as current
      typeDefinitions.push({
        segmentLength,
        beeSon: new BeeSon({ typeSpecificationManager }),
        marker,
      })

      j++
    } else {
      assertBeeSonType(type)

      // if deserialized type is container type, then its typeSpecification has to be deserialized in a different function call
      const typeSpecificationManager = new TypeSpecification(
        header.obfuscationKey,
        header.version,
        type,
        null,
      )
      typeDefinitions.push({
        segmentLength,
        beeSon: new BeeSon({ typeSpecificationManager }),
        marker,
      })
    }

    offset += OBJECT_TYPE_DEF_LENGTH
    i++
  }

  if (j !== superTypeRefArrayLength) {
    throw new Error(
      `There were ${j} superTypeDefintions when it should be exactly ${superTypeRefArrayLength}`,
    )
  }

  return {
    typeSpecificationManager: new TypeSpecification(
      header.obfuscationKey,
      header.version,
      Type.object,
      typeDefinitions,
    ),
    typeSpecificationByteSize,
  }
}

export function serializeObject(typeSpecification: TypeSpecification<Type.object>): Uint8Array {
  // this marker array with be correspond to the typeDefs and superTypeDefs order
  const serializedMarkers = getSerializedMarkers(typeSpecification)
  const typeDefinitions = typeSpecification.typeDefinitions
  const { typeDefArray, superTypeRefArray } = serializeTypeDefinitions(typeDefinitions, serializedMarkers)
  const flattenTypeDefs = flattenBytesArray(typeDefArray)
  const flattenSuperTypeRefs = flattenBytesArray(superTypeRefArray)

  const bytes = new Uint8Array([
    ...serializeUint16(typeDefArray.length),
    ...serializeUint16(superTypeRefArray.length),
    ...serializeUint16(serializedMarkers.serializedMarkers.length),
    ...flattenTypeDefs,
    ...serializedMarkers.serializedMarkers,
  ])

  return new Uint8Array([...segmentPaddingFromRight(bytes), ...flattenSuperTypeRefs])
}

type SerializedMarkers = { serializedMarkerLengths: Bytes<2>[]; serializedMarkers: Uint8Array }

function serializeMarkers(markers: string[]): SerializedMarkers {
  const serializedMarkers = serializeString(markers.join(''))
  const serializedMarkerLengths: Bytes<2>[] = []
  for (const key of markers) {
    serializedMarkerLengths.push(serializeUint16(key.length))
  }

  return {
    serializedMarkerLengths,
    serializedMarkers,
  }
}

interface RSerializeTypeDefinitions {
  typeDefArray: TypeDefElement[]
  superTypeRefArray: Bytes<32>[]
  /** Notates the nullable types in the array in a bitvector. Can be ignored when container type is not nullable */
  bv: BitVector
}

/** Serializes typeDefinitions and superTypeDefinitions of an object */
function serializeTypeDefinitions(
  typeDefinitions: TypeDefinitionO[],
  serializedMarkers: SerializedMarkers,
): RSerializeTypeDefinitions {
  //
  const typeDefArray: TypeDefElement[] = []
  const superTypeRefArray: Bytes<32>[] = []
  const bv = new BitVector(typeDefinitions.length)

  let index = 0
  for (const typeDefinition of typeDefinitions.values()) {
    let type: number = typeDefinition.beeSon.typeSpecificationManager.type

    if (typeDefinition.beeSon.superBeeSon) {
      type = SUPER_BEESON_TYPE
      // calculate typeSpecification's reference (Swarm hash)
      const manager = typeDefinition.beeSon.typeSpecificationManager
      manager.superBeeSon = false
      const typeSpecData = manager.serialize()
      manager.superBeeSon = true
      const typeSpecRef = makeChunkedFile(typeSpecData).address()
      superTypeRefArray.push(typeSpecRef)
    }

    typeDefArray.push(
      new Bytes([
        ...serializeType(type),
        ...serializeUint32(typeDefinition.segmentLength),
        ...serializedMarkers.serializedMarkerLengths[index],
      ]),
    )

    if (typeDefinition.beeSon.typeSpecificationManager.nullable) {
      bv.setBit(index)
    }
    index++
  }

  return { typeDefArray, superTypeRefArray, bv }
}

interface RDeserializeTypeSpecLengths {
  typeDefArrayLength: number
  superTypeRefArrayLength: number
  markersByteLength: number
  /** required byte offset on `data` after Lengths */
  offset: number
}

function deserializeTypeSpecLengths(data: Uint8Array): RDeserializeTypeSpecLengths {
  let offset = 0
  // N
  const typeDefArrayLength = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
  offset += 2
  // M
  const superTypeRefArrayLength = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
  offset += 2
  const markersByteLength = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
  offset += 2

  return {
    typeDefArrayLength,
    superTypeRefArrayLength,
    markersByteLength,
    offset,
  }
}

/** Also changes the order in the typeDefinitions of the typeSpecification with respect to the superBeeSon types */
function getSerializedMarkers(
  typeSpecification: TypeSpecification<Type.object> | TypeSpecification<Type.nullableObject>,
): SerializedMarkers {
  const markers = typeSpecification.typeDefinitions.map(typeDef => typeDef.marker)

  // this marker array with be correspond to the typeDefs and superTypeDefs order
  return serializeMarkers(markers)
}
