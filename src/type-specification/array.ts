import { TypeManager, Header, TypeDefinitionA } from '.'
import { BeeSon } from '../beeson'
import { BitVector } from '../bitvector'
import {
  deserializeUint16,
  deserializeUint32,
  serializeUint16,
  serializeUint32,
} from '../marshalling/number-serializer'
import {
  assertBeeSonType,
  deserializeType,
  serializeType,
  StorageLoader,
  SUPER_BEESON_TYPE,
  Type,
} from '../types'
import { Bytes, flattenBytesArray, segmentPaddingFromRight, segmentSize, SEGMENT_SIZE } from '../utils'

const ARRAY_TYPE_DEF_LENGTH = 6

type TypeDefElement = Bytes<6>

export function serializeArray(typeManager: TypeManager<Type.array>): Uint8Array {
  const { typeDefArray, superTypeRefArray } = serializeTypeDefinitions(typeManager.typeDefinitions)
  const flattenTypeDefs = flattenBytesArray(typeDefArray)
  const flattenSuperTypeRefs = flattenBytesArray(superTypeRefArray)

  // not padded bytes
  const bytes = new Uint8Array([
    ...serializeUint16(typeDefArray.length),
    ...serializeUint16(superTypeRefArray.length),
    ...flattenTypeDefs,
  ])

  return new Uint8Array([...segmentPaddingFromRight(bytes), ...flattenSuperTypeRefs])
}

/**
 *
 * @param data raw beeson array TypeSpecification data without the blob header
 * @param header blob header of the beeson data
 * @returns
 */
export async function deserializeArray(
  data: Uint8Array,
  header: Header<Type.array>,
  storageLoader?: StorageLoader,
): Promise<{ typeManager: TypeManager<Type.array>; typeSpecificationByteSize: number }> {
  const lengths = deserializeTypeSpecLengths(data)
  const { typeDefArrayLength, superTypeRefArrayLength } = lengths
  let offset = lengths.offset

  // after arrays it is padded from right
  const segmentsUntilSuperBeeSonRefs = segmentSize(
    lengths.offset + typeDefArrayLength * ARRAY_TYPE_DEF_LENGTH,
  )
  const bytesUntilSuperBeeSonRefs = segmentsUntilSuperBeeSonRefs * SEGMENT_SIZE
  const typeSpecificationByteSize = bytesUntilSuperBeeSonRefs + superTypeRefArrayLength * SEGMENT_SIZE // latter is the ref array's length

  // deserialize typedefs
  const typeDefinitions: TypeDefinitionA[] = []
  let i = 0
  let j = 0 // superTypeDef index
  while (i < typeDefArrayLength) {
    const type = deserializeType(data.slice(offset, offset + 2) as Bytes<2>)
    const segmentLength = deserializeUint32(data.slice(offset + 2, offset + 6) as Bytes<4>)

    // superBeeSon handling
    if (Number(type) === SUPER_BEESON_TYPE) {
      if (!storageLoader) {
        throw new Error(`StorageLoader is not defined`)
      }

      const refOffset = bytesUntilSuperBeeSonRefs + j * SEGMENT_SIZE
      const superTypeRef = data.slice(refOffset, refOffset + SEGMENT_SIZE) as Bytes<32>
      const typeSpecificationData = await storageLoader(superTypeRef)
      const { typeManager } = await TypeManager.deserialize(typeSpecificationData, undefined, storageLoader)
      typeManager.superBeeSon = true
      // TODO check `typeSpecificationManager` header has the same version as current
      typeDefinitions.push({
        segmentLength,
        beeSon: new BeeSon({ typeManager }),
      })

      j++
    } else {
      // not superBeeSon
      assertBeeSonType(type)
      // if deserialized type is container type, then its typeSpecification has to be deserialized in a different function call
      const typeManager = new TypeManager(header.version, type, null)
      typeDefinitions.push({
        segmentLength,
        beeSon: new BeeSon({ typeManager }),
      })
    }

    offset += ARRAY_TYPE_DEF_LENGTH
    i++
  }

  if (j !== superTypeRefArrayLength) {
    throw new Error(
      `There were ${j} superTypeDefintions when it should be exactly ${superTypeRefArrayLength}`,
    )
  }

  return {
    typeManager: new TypeManager(header.version, Type.array, typeDefinitions),
    typeSpecificationByteSize,
  }
}

export function serializeNullableArray(typeManager: TypeManager<Type.nullableArray>): Uint8Array {
  const { typeDefArray, superTypeRefArray, bv } = serializeTypeDefinitions(typeManager.typeDefinitions)
  const flattenTypeDefs = flattenBytesArray(typeDefArray)
  const flattenSuperTypeRefs = flattenBytesArray(superTypeRefArray)
  const bitVectorSegments = segmentPaddingFromRight(bv.bitVector)

  const bytes = new Uint8Array([
    ...serializeUint16(typeDefArray.length),
    ...serializeUint16(superTypeRefArray.length),
    ...flattenTypeDefs,
    ...bitVectorSegments,
  ])

  return new Uint8Array([...segmentPaddingFromRight(bytes), ...flattenSuperTypeRefs])
}

/**
 *
 * @param data raw beeson array TypeSpecification data without the blob header
 * @param header blob header of the beeson data
 * @returns
 */
export async function deserializeNullableArray(
  data: Uint8Array,
  header: Header<Type.nullableArray>,
  storageLoader?: StorageLoader,
): Promise<{
  typeManager: TypeManager<Type.nullableArray>
  typeSpecificationByteSize: number
}> {
  const lengths = deserializeTypeSpecLengths(data)
  const { typeDefArrayLength, superTypeRefArrayLength } = lengths
  let offset = lengths.offset

  // init bitvector
  const starBitVektorByteIndex = offset + typeDefArrayLength * ARRAY_TYPE_DEF_LENGTH
  const bitVector = new BitVector(
    typeDefArrayLength,
    data.slice(starBitVektorByteIndex, starBitVektorByteIndex + Math.ceil(typeDefArrayLength / 8)),
  )
  // after bitvector it is padded from right
  const segmentsUntilSuperBeeSonRefs = segmentSize(
    lengths.offset + typeDefArrayLength * ARRAY_TYPE_DEF_LENGTH + bitVector.bitVector.length,
  )
  const bytesUntilSuperBeeSonRefs = segmentsUntilSuperBeeSonRefs * SEGMENT_SIZE
  const typeSpecificationByteSize = bytesUntilSuperBeeSonRefs + superTypeRefArrayLength * SEGMENT_SIZE // latter is the ref array's length

  // deserialize typedefs
  const typeDefinitions: TypeDefinitionA[] = []
  let i = 0
  let j = 0 // superTypeDef index
  while (i < typeDefArrayLength) {
    const type = deserializeType(data.slice(offset, offset + 2) as Bytes<2>)
    const segmentLength = deserializeUint32(data.slice(offset + 2, offset + 6) as Bytes<4>)
    const nullable = bitVector.getBit(i)

    // superBeeSon handling
    if (Number(type) === SUPER_BEESON_TYPE) {
      if (!storageLoader) {
        throw new Error(`StorageLoader is not defined`)
      }
      const refOffset = bytesUntilSuperBeeSonRefs + j * SEGMENT_SIZE
      const superTypeRef = data.slice(refOffset, refOffset + SEGMENT_SIZE) as Bytes<32>

      const typeSpecificationData = await storageLoader(superTypeRef)
      const { typeManager } = await TypeManager.deserialize(typeSpecificationData, undefined, storageLoader)
      typeManager.nullable = nullable
      typeManager.superBeeSon = true
      //TODO check `typeSpecificationManager` header has the same version as current
      typeDefinitions.push({
        segmentLength,
        beeSon: new BeeSon({ typeManager }),
      })

      j++
    } else {
      // not superBeeSon
      assertBeeSonType(type)

      // if deserialized type is container type, then its typeSpecification has to be deserialized in a different function call
      const typeManager = new TypeManager(header.version, type, null, nullable)
      typeDefinitions.push({
        segmentLength,
        beeSon: new BeeSon({ typeManager }),
      })
    }

    offset += ARRAY_TYPE_DEF_LENGTH
    i++
  }

  if (j !== superTypeRefArrayLength) {
    throw new Error(
      `There were ${j} superTypeDefintions when it should be exactly ${superTypeRefArrayLength}`,
    )
  }

  return {
    typeManager: new TypeManager(header.version, Type.nullableArray, typeDefinitions),
    typeSpecificationByteSize,
  }
}

interface RSerializeTypeDefinitions {
  typeDefArray: TypeDefElement[]
  superTypeRefArray: Bytes<32>[]
  /** Notates the nullable types in the array in a bitvector. Can be ignored when container type is not nullable */
  bv: BitVector
}

/** Serializes typeDefinitions and superTypeDefinitions of an array */
function serializeTypeDefinitions(typeDefinitions: TypeDefinitionA[]): RSerializeTypeDefinitions {
  const typeDefArray: TypeDefElement[] = []
  const superTypeRefArray: Bytes<32>[] = []
  const bv = new BitVector(typeDefinitions.length)
  for (const [index, typeDefinition] of typeDefinitions.entries()) {
    if (typeDefinition.beeSon.superBeeSon) {
      typeDefArray.push(
        new Bytes([...serializeType(SUPER_BEESON_TYPE), ...serializeUint32(typeDefinition.segmentLength)]),
      )
      // calculate typeSpecification's reference (Swarm hash)
      const manager = typeDefinition.beeSon.typeManager
      const typeSpecRef = manager.swarmAddress()
      superTypeRefArray.push(typeSpecRef)
    } else {
      typeDefArray.push(
        new Bytes([
          ...serializeType(typeDefinition.beeSon.typeManager.type),
          ...serializeUint32(typeDefinition.segmentLength),
        ]),
      )
    }

    if (typeDefinition.beeSon.typeManager.nullable) {
      bv.setBit(index)
    }
  }

  return { typeDefArray, superTypeRefArray, bv }
}

interface RDeserializeTypeSpecLengths {
  typeDefArrayLength: number
  superTypeRefArrayLength: number
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

  return {
    superTypeRefArrayLength,
    typeDefArrayLength,
    offset,
  }
}
