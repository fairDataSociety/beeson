import { TypeSpecification, Header, TypeDefinitionO } from '.'
import { BeeSon } from '../beeson'
import { Type, assertBeeSonType, serializeType, deserializeType } from '../types'
import { BitVector } from '../bitvector'
import {
  deserializeUint16,
  deserializeUint32,
  serializeUint16,
  serializeUint32,
} from '../marshalling/number-serializer'
import { serializeString } from '../marshalling/string-seralizer'
import { Bytes, bytesToString, flattenBytesArray, segmentSize } from '../utils'

const OBJECT_TYPE_DEF_LENGTH = 8

export function typeSpecificationNullableObject(
  typeSpecification: TypeSpecification<Type.nullableObject>,
): Uint8Array {
  const markers = typeSpecification.typeDefinitions.map(typeDef => typeDef.marker)
  const serializedMarkers = serializeMarkers(markers)
  const bv = new BitVector(typeSpecification.typeDefinitions.length)

  const serializedTypeDefs: Bytes<8>[] = []
  for (const [index, typeDefinition] of typeSpecification.typeDefinitions.entries()) {
    serializedTypeDefs.push(
      new Bytes([
        ...serializeType(typeDefinition.beeSon.typeSpecificationManager.type),
        ...serializeUint32(typeDefinition.segmentLength),
        ...serializedMarkers.serializedMarkerLengths[index],
      ]),
    )
    if (typeDefinition.beeSon.typeSpecificationManager.nullable) {
      bv.setBit(index)
    }
  }
  const flattenTypeDefs = flattenBytesArray(serializedTypeDefs)
  // 6 is the bytes length of the `typeSpecificationSegmentSize`, `flattenTypeDefs` and the `serializedMarkers.length`
  const typeSpecificationSegmentSize = segmentSize(
    6 + flattenTypeDefs.length + serializedMarkers.serializedMarkers.length + bv.bitVector.length,
  )

  const bytes = new Uint8Array([
    ...serializeUint16(typeSpecificationSegmentSize),
    ...serializeUint16(serializedTypeDefs.length),
    ...serializeUint16(serializedMarkers.serializedMarkers.length),
    ...flattenBytesArray(serializedTypeDefs),
    ...serializedMarkers.serializedMarkers,
    ...bv.bitVector,
  ])

  return bytes
}

export function deserializeNullableObject(
  data: Uint8Array,
  header: Header<Type.nullableObject>,
): { typeSpecificationManager: TypeSpecification<Type.nullableObject>; typeSpecificationByteSize: number } {
  let offset = 0
  const typeSpecificationSegmentSize = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
  offset += 2
  const flattenTypeDefsLength = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
  offset += 2
  const markerBytesLength = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
  offset += 2
  const starBitVektorByteIndex = offset + flattenTypeDefsLength * OBJECT_TYPE_DEF_LENGTH + markerBytesLength
  const bitVector = new BitVector(
    flattenTypeDefsLength,
    data.slice(starBitVektorByteIndex, starBitVektorByteIndex + Math.ceil(flattenTypeDefsLength / 8)),
  )

  // deserialize typedefs
  const typeSpecificationByteSize = typeSpecificationSegmentSize * 32
  const startMarkerByteIndex = offset + flattenTypeDefsLength * OBJECT_TYPE_DEF_LENGTH
  const typeDefinitions: TypeDefinitionO[] = []
  let i = 0
  let markerOffset = 0
  while (offset < OBJECT_TYPE_DEF_LENGTH * flattenTypeDefsLength) {
    const type = deserializeType(data.slice(offset, offset + 2) as Bytes<2>)
    const segmentLength = deserializeUint32(data.slice(offset + 2, offset + 6) as Bytes<4>)

    const markerLength = deserializeUint16(data.slice(offset + 6, offset + 8) as Bytes<2>)
    const marker = bytesToString(
      data.slice(startMarkerByteIndex + markerOffset, startMarkerByteIndex + markerOffset + markerLength),
    )
    markerOffset += markerLength

    try {
      assertBeeSonType(type)

      // if deserialized type is container type, then its typeSpecification has to be deserialized in a different function call
      const typeSpecificationManager = new TypeSpecification(
        header.obfuscationKey,
        header.version,
        type,
        null,
        bitVector.getBit(i),
      )
      typeDefinitions.push({
        segmentLength,
        beeSon: new BeeSon({ typeSpecificationManager: typeSpecificationManager }),
        marker,
      })
    } catch (e) {
      throw new Error(`Error at BeeSon array deserialization at offset ${offset}: ${(e as Error).message}`)
    }

    offset += OBJECT_TYPE_DEF_LENGTH
    i++
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

export function deserializeObject(
  data: Uint8Array,
  header: Header<Type.object>,
): { typeSpecificationManager: TypeSpecification<Type.object>; typeSpecificationByteSize: number } {
  let offset = 0
  const typeSpecificationSegmentSize = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
  offset += 2
  const flattenTypeDefsLength = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
  offset += 2

  // deserialize typedefs
  const typeSpecificationByteSize = typeSpecificationSegmentSize * 32
  const startMarkerByteIndex = offset + flattenTypeDefsLength * OBJECT_TYPE_DEF_LENGTH
  const typeDefinitions: TypeDefinitionO[] = []
  let markerOffset = 0
  while (offset < OBJECT_TYPE_DEF_LENGTH * flattenTypeDefsLength) {
    const type = deserializeType(data.slice(offset, offset + 2) as Bytes<2>)
    const segmentLength = deserializeUint32(data.slice(offset + 2, offset + 6) as Bytes<4>)

    const markerLength = deserializeUint16(data.slice(offset + 6, offset + 8) as Bytes<2>)
    const marker = bytesToString(
      data.slice(startMarkerByteIndex + markerOffset, startMarkerByteIndex + markerOffset + markerLength),
    )
    markerOffset += markerLength

    try {
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
        beeSon: new BeeSon({ typeSpecificationManager: typeSpecificationManager }),
        marker,
      })
    } catch (e) {
      throw new Error(`Error at BeeSon array deserialization at offset ${offset}: ${(e as Error).message}`)
    }

    offset += OBJECT_TYPE_DEF_LENGTH
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

export function typeSpecificationObject(typeSpecification: TypeSpecification<Type.object>): Uint8Array {
  const markers = typeSpecification.typeDefinitions.map(typeDef => typeDef.marker)
  const serializedMarkers = serializeMarkers(markers)

  const serializedTypeDefs: Bytes<8>[] = []
  for (const [index, typeDefinition] of typeSpecification.typeDefinitions.entries()) {
    serializedTypeDefs.push(
      new Bytes([
        ...serializeType(typeDefinition.beeSon.typeSpecificationManager.type),
        ...serializeUint32(typeDefinition.segmentLength),
        ...serializedMarkers.serializedMarkerLengths[index],
      ]),
    )
  }
  const flattenTypeDefs = flattenBytesArray(serializedTypeDefs)
  // 4 is the bytes length of the `typeSpecificationSegmentSize` and `flattenTypeDefs
  const typeSpecificationSegmentSize = segmentSize(
    4 + flattenTypeDefs.length + serializedMarkers.serializedMarkers.length,
  )

  const bytes = new Uint8Array([
    ...serializeUint16(typeSpecificationSegmentSize),
    ...serializeUint16(serializedTypeDefs.length),
    ...flattenBytesArray(serializedTypeDefs),
    ...serializedMarkers.serializedMarkers,
  ])

  return bytes
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
