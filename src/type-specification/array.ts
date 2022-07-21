import { TypeSpecification, Header, TypeDefinitionA } from '.'
import { BeeSon } from '../beeson'
import { BitVector } from '../bitvector'
import {
  deserializeUint16,
  deserializeUint32,
  serializeUint16,
  serializeUint32,
} from '../marshalling/number-serializer'
import { assertBeeSonType, deserializeType, serializeType, Type } from '../types'
import { Bytes, flattenBytesArray, segmentPaddingFromRight, segmentSize } from '../utils'

const ARRAY_TYPE_DEF_LENGTH = 6

export function serializeArray(typeSpecification: TypeSpecification<Type.array>): Uint8Array {
  const serializedTypeDefs: Bytes<6>[] = []
  for (const typeDefinition of typeSpecification.typeDefinitions) {
    serializedTypeDefs.push(
      new Bytes([
        ...serializeType(typeDefinition.beeSon.typeSpecificationManager.type),
        ...serializeUint32(typeDefinition.segmentLength),
      ]),
    )
  }
  const flattenTypeDefs = flattenBytesArray(serializedTypeDefs)
  // 4 is the bytes length of the `typeSpecificationSegmentSize` and `flattenTypeDefs
  const typeSpecificationSegmentSize = segmentSize(4 + flattenTypeDefs.length)

  const bytes = new Uint8Array([
    ...serializeUint16(typeSpecificationSegmentSize),
    ...serializeUint16(typeSpecification.typeDefinitions.length),
    ...flattenTypeDefs,
  ])

  return bytes
}

/**
 *
 * @param data raw beeson array TypeSpecification data without the blob header
 * @param header blob header of the beeson data
 * @returns
 */
export function deserializeArray(
  data: Uint8Array,
  header: Header<Type.array>,
): { typeSpecificationManager: TypeSpecification<Type.array>; typeSpecificationByteSize: number } {
  let offset = 0
  const typeSpecificationSegmentSize = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
  offset += 2
  const flattenTypeDefsLength = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
  offset += 2

  // deserialize typedefs
  const typeSpecificationByteSize = typeSpecificationSegmentSize * 32
  const typeDefinitions: TypeDefinitionA[] = []
  while (offset < ARRAY_TYPE_DEF_LENGTH * flattenTypeDefsLength) {
    const type = deserializeType(data.slice(offset, offset + 2) as Bytes<2>)
    const segmentLength = deserializeUint32(data.slice(offset + 2, offset + 6) as Bytes<4>)

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
        beeSon: new BeeSon({ typeSpecificationManager }),
      })
    } catch (e) {
      throw new Error(`Error at BeeSon array deserialization at offset ${offset}: ${(e as Error).message}`)
    }

    offset += ARRAY_TYPE_DEF_LENGTH
  }

  return {
    typeSpecificationManager: new TypeSpecification(
      header.obfuscationKey,
      header.version,
      Type.array,
      typeDefinitions,
    ),
    typeSpecificationByteSize,
  }
}

export function serializeNullableArray(typeSpecification: TypeSpecification<Type.nullableArray>): Uint8Array {
  const serializedTypeDefs: Bytes<6>[] = []
  const bv = new BitVector(typeSpecification.typeDefinitions.length)
  for (const [index, typeDefinition] of typeSpecification.typeDefinitions.entries()) {
    serializedTypeDefs.push(
      new Bytes([
        ...serializeType(typeDefinition.beeSon.typeSpecificationManager.type),
        ...serializeUint32(typeDefinition.segmentLength),
      ]),
    )
    if (typeDefinition.beeSon.typeSpecificationManager.nullable) {
      bv.setBit(index)
    }
  }
  const flattenTypeDefs = flattenBytesArray(serializedTypeDefs)
  const bitVectorSegments = segmentPaddingFromRight(bv.bitVector)

  // 4 is the bytes length of the `typeSpecificationSegmentSize` and `flattenTypeDefs
  const typeSpecificationSegmentSize = segmentSize(4 + flattenTypeDefs.length + bitVectorSegments.length)

  const bytes = new Uint8Array([
    ...serializeUint16(typeSpecificationSegmentSize),
    ...serializeUint16(typeSpecification.typeDefinitions.length),
    ...flattenTypeDefs,
    ...bitVectorSegments,
  ])

  return bytes
}

/**
 *
 * @param data raw beeson array TypeSpecification data without the blob header
 * @param header blob header of the beeson data
 * @returns
 */
export function deserializeNullableArray(
  data: Uint8Array,
  header: Header<Type.nullableArray>,
): { typeSpecificationManager: TypeSpecification<Type.nullableArray>; typeSpecificationByteSize: number } {
  let offset = 0
  const typeSpecificationSegmentSize = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
  offset += 2
  const flattenTypeDefsLength = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
  offset += 2
  const starBitVektorByteIndex = 4 + flattenTypeDefsLength * ARRAY_TYPE_DEF_LENGTH
  const bitVector = new BitVector(
    flattenTypeDefsLength,
    data.slice(starBitVektorByteIndex, starBitVektorByteIndex + Math.ceil(flattenTypeDefsLength / 8)),
  )

  // deserialize typedefs
  const typeSpecificationByteSize = typeSpecificationSegmentSize * 32
  const typeDefinitions: TypeDefinitionA[] = []
  let i = 0
  while (offset < ARRAY_TYPE_DEF_LENGTH * flattenTypeDefsLength) {
    const type = deserializeType(data.slice(offset, offset + 2) as Bytes<2>)
    const segmentLength = deserializeUint32(data.slice(offset + 2, offset + 6) as Bytes<4>)

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
      })
    } catch (e) {
      throw new Error(`Error at BeeSon array deserialization at offset ${offset}: ${(e as Error).message}`)
    }

    offset += ARRAY_TYPE_DEF_LENGTH
    i++
  }

  return {
    typeSpecificationManager: new TypeSpecification(
      header.obfuscationKey,
      header.version,
      Type.nullableArray,
      typeDefinitions,
    ),
    typeSpecificationByteSize: typeSpecificationByteSize,
  }
}
