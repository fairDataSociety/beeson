import { AbiManager, Header, TypeDefinitionA } from '.'
import { BeeSon } from '../beeson'
import { BitVector } from '../bitvector'
import {
  deserializeUint16,
  deserializeUint32,
  serializeUint16,
  serializeUint32,
} from '../marshalling/number-serializer'
import { assertBeeSonType, Type } from '../types'
import { Bytes, encryptDecrypt, flattenBytesArray, segmentPaddingFromRight, segmentSize } from '../utils'

const ARRAY_TYPE_DEF_LENGTH = 5

export function dnaArrayAbi(abi: AbiManager<Type.array>): Uint8Array {
  const serializedTypeDefs: Bytes<5>[] = []
  for (const typeDefinition of abi.typeDefinitions) {
    serializedTypeDefs.push(
      new Bytes([typeDefinition.beeSon.abiManager.type, ...serializeUint32(typeDefinition.segmentLength)]),
    )
  }
  const flattenTypeDefs = flattenBytesArray(serializedTypeDefs)
  // 4 is the bytes length of the `abiSegmentSize` and `flattenTypeDefs
  const abiSegmentSize = segmentSize(4 + flattenTypeDefs.length)

  const bytes = new Uint8Array([
    ...serializeUint16(abiSegmentSize),
    ...serializeUint16(abi.typeDefinitions.length),
    ...flattenTypeDefs,
  ])

  return bytes
}

/**
 *
 * @param data raw beeson array ABI data without the blob header
 * @param header blob header of the beeson data
 * @returns
 */
export function spawnArrayAbi(
  data: Uint8Array,
  header: Header<Type.array>,
): { abiManager: AbiManager<Type.array>; abiByteSize: number } {
  encryptDecrypt(header.obfuscationKey, data)

  let offset = 0
  const abiSegmentSize = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
  offset += 2
  const flattenTypeDefsLength = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
  offset += 2

  // deserialize typedefs
  const abiByteSize = abiSegmentSize * 32
  const typeDefinitions: TypeDefinitionA[] = []
  while (offset < ARRAY_TYPE_DEF_LENGTH * flattenTypeDefsLength) {
    const type = data.slice(offset, offset + 1)[0]
    const segmentLength = deserializeUint32(data.slice(offset + 1, offset + 5) as Bytes<4>)

    try {
      assertBeeSonType(type)

      // if deserialized type is container type, then its abi has to be deserialized in a different function call
      const abiManager = new AbiManager(header.obfuscationKey, header.version, type, null)
      typeDefinitions.push({
        segmentLength,
        beeSon: new BeeSon({ abiManager }),
      })
    } catch (e) {
      throw new Error(`Error at BeeSon array deserialization at offset ${offset}: ${(e as Error).message}`)
    }

    offset += ARRAY_TYPE_DEF_LENGTH
  }

  return {
    abiManager: new AbiManager(header.obfuscationKey, header.version, Type.array, typeDefinitions),
    abiByteSize,
  }
}

export function dnaNullableArrayAbi(abi: AbiManager<Type.nullableArray>): Uint8Array {
  const serializedTypeDefs: Bytes<5>[] = []
  const bv = new BitVector(abi.typeDefinitions.length)
  for (const [index, typeDefinition] of abi.typeDefinitions.entries()) {
    serializedTypeDefs.push(
      new Bytes([typeDefinition.beeSon.abiManager.type, ...serializeUint32(typeDefinition.segmentLength)]),
    )
    if (typeDefinition.beeSon.abiManager.nullable) {
      bv.setBit(index)
    }
  }
  const flattenTypeDefs = flattenBytesArray(serializedTypeDefs)
  const bitVectorSegments = segmentPaddingFromRight(bv.bitVector)

  // 4 is the bytes length of the `abiSegmentSize` and `flattenTypeDefs
  const abiSegmentSize = segmentSize(4 + flattenTypeDefs.length + bitVectorSegments.length)

  const bytes = new Uint8Array([
    ...serializeUint16(abiSegmentSize),
    ...serializeUint16(abi.typeDefinitions.length),
    ...flattenTypeDefs,
    ...bitVectorSegments,
  ])

  return bytes
}

/**
 *
 * @param data raw beeson array ABI data without the blob header
 * @param header blob header of the beeson data
 * @returns
 */
export function spawnNullableArrayAbi(
  data: Uint8Array,
  header: Header<Type.nullableArray>,
): { abiManager: AbiManager<Type.nullableArray>; abiByteSize: number } {
  encryptDecrypt(header.obfuscationKey, data)

  let offset = 0
  const abiSegmentSize = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
  offset += 2
  const flattenTypeDefsLength = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
  offset += 2
  const starBitVektorByteIndex = 4 + flattenTypeDefsLength * 5
  const bitVector = new BitVector(
    flattenTypeDefsLength,
    data.slice(starBitVektorByteIndex, starBitVektorByteIndex + Math.ceil(flattenTypeDefsLength / 8)),
  )

  // deserialize typedefs
  const abiByteSize = abiSegmentSize * 32
  const typeDefinitions: TypeDefinitionA[] = []
  let i = 0
  while (offset < ARRAY_TYPE_DEF_LENGTH * flattenTypeDefsLength) {
    const type = data.slice(offset, offset + 1)[0]
    const segmentLength = deserializeUint32(data.slice(offset + 1, offset + 5) as Bytes<4>)

    try {
      assertBeeSonType(type)

      // if deserialized type is container type, then its abi has to be deserialized in a different function call
      const abiManager = new AbiManager(
        header.obfuscationKey,
        header.version,
        type,
        null,
        bitVector.getBit(i),
      )
      typeDefinitions.push({
        segmentLength,
        beeSon: new BeeSon({ abiManager }),
      })
    } catch (e) {
      throw new Error(`Error at BeeSon array deserialization at offset ${offset}: ${(e as Error).message}`)
    }

    offset += ARRAY_TYPE_DEF_LENGTH
    i++
  }

  return {
    abiManager: new AbiManager(header.obfuscationKey, header.version, Type.nullableArray, typeDefinitions),
    abiByteSize,
  }
}
