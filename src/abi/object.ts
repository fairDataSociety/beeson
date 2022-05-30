import { AbiManager, Header, TypeDefinitionO } from '.'
import { assertBeeSonType, BeeSon, Type } from '..'
import { BitVector } from '../bitvector'
import { deserializeUint16, deserializeUint32, serializeUint16, serializeUint32 } from '../number-serializer'
import { serializeString } from '../string-seralizer'
import { Bytes, bytesToString, encryptDecrypt, flattenBytesArray, segmentSize } from '../utils'

const OBJECT_TYPE_DEF_LENGTH = 7

export function serializeNullableObjectAbi(abi: AbiManager<Type.nullableObject>): Uint8Array {
  const markers = abi.typeDefinitions.map(typeDef => typeDef.marker)
  const serializedMarkers = serializeMarkers(markers)
  const bv = new BitVector(abi.typeDefinitions.length)

  const serializedTypeDefs: Bytes<7>[] = []
  for (const [index, typeDefinition] of abi.typeDefinitions.entries()) {
    serializedTypeDefs.push(
      new Bytes([
        typeDefinition.beeSon.abiManager.type.charCodeAt(0),
        ...serializeUint32(typeDefinition.segmentLength),
        ...serializedMarkers.serializedMarkerLengths[index],
      ]),
    )
    if (typeDefinition.beeSon.abiManager.nullable) {
      bv.setBit(index)
    }
  }
  const flattenTypeDefs = flattenBytesArray(serializedTypeDefs)
  // 6 is the bytes length of the `abiSegmentSize`, `flattenTypeDefs` and the `serializedMarkers.length`
  const abiSegmentSize = segmentSize(
    6 + flattenTypeDefs.length + serializedMarkers.serializedMarkers.length + bv.bitVector.length,
  )

  const bytes = new Uint8Array([
    ...serializeUint16(abiSegmentSize),
    ...serializeUint16(serializedTypeDefs.length),
    ...serializeUint16(serializedMarkers.serializedMarkers.length),
    ...flattenBytesArray(serializedTypeDefs),
    ...serializedMarkers.serializedMarkers,
    ...bv.bitVector,
  ])

  return bytes
}

export function deserializeNullableObjectAbi(
  data: Uint8Array,
  header: Header<Type.nullableObject>,
): { abiManager: AbiManager<Type.nullableObject>; abiByteSize: number } {
  encryptDecrypt(header.obfuscationKey, data)

  let offset = 0
  const abiSegmentSize = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
  offset += 2
  const flattenTypeDefsLength = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
  offset += 2
  const markerBytesLength = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
  offset += 2
  const starBitVektorByteIndex = offset + flattenTypeDefsLength * 7 + markerBytesLength
  const bitVector = new BitVector(
    flattenTypeDefsLength,
    data.slice(starBitVektorByteIndex, starBitVektorByteIndex + Math.ceil(flattenTypeDefsLength / 8)),
  )

  // deserialize typedefs
  const abiByteSize = abiSegmentSize * 32
  const startMarkerByteIndex = offset + flattenTypeDefsLength * OBJECT_TYPE_DEF_LENGTH
  const typeDefinitions: TypeDefinitionO[] = []
  let i = 0
  let markerOffset = 0
  while (offset < OBJECT_TYPE_DEF_LENGTH * flattenTypeDefsLength) {
    const type = String.fromCharCode(data.slice(offset, offset + 1)[0])
    const segmentLength = deserializeUint32(data.slice(offset + 1, offset + 5) as Bytes<4>)

    const markerLength = deserializeUint16(data.slice(offset + 5, offset + 7) as Bytes<2>)
    const marker = bytesToString(
      data.slice(startMarkerByteIndex + markerOffset, startMarkerByteIndex + markerOffset + markerLength),
    )
    markerOffset += markerLength

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
        marker,
      })
    } catch (e) {
      throw new Error(`Error at BeeSon array deserialization at offset ${offset}: ${(e as Error).message}`)
    }

    offset += OBJECT_TYPE_DEF_LENGTH
    i++
  }

  return {
    abiManager: new AbiManager(header.obfuscationKey, header.version, Type.nullableObject, typeDefinitions),
    abiByteSize,
  }
}

export function deserializeObjectAbi(
  data: Uint8Array,
  header: Header<Type.object>,
): { abiManager: AbiManager<Type.object>; abiByteSize: number } {
  encryptDecrypt(header.obfuscationKey, data)

  let offset = 0
  const abiSegmentSize = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
  offset += 2
  const flattenTypeDefsLength = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
  offset += 2

  // deserialize typedefs
  const abiByteSize = abiSegmentSize * 32
  const startMarkerByteIndex = offset + flattenTypeDefsLength * OBJECT_TYPE_DEF_LENGTH
  const typeDefinitions: TypeDefinitionO[] = []
  let markerOffset = 0
  while (offset < OBJECT_TYPE_DEF_LENGTH * flattenTypeDefsLength) {
    const type = String.fromCharCode(data.slice(offset, offset + 1)[0])
    const segmentLength = deserializeUint32(data.slice(offset + 1, offset + 5) as Bytes<4>)

    const markerLength = deserializeUint16(data.slice(offset + 5, offset + 7) as Bytes<2>)
    const marker = bytesToString(
      data.slice(startMarkerByteIndex + markerOffset, startMarkerByteIndex + markerOffset + markerLength),
    )
    markerOffset += markerLength

    try {
      assertBeeSonType(type)

      // if deserialized type is container type, then its abi has to be deserialized in a different function call
      const abiManager = new AbiManager(header.obfuscationKey, header.version, type, null)
      typeDefinitions.push({
        segmentLength,
        beeSon: new BeeSon({ abiManager }),
        marker,
      })
    } catch (e) {
      throw new Error(`Error at BeeSon array deserialization at offset ${offset}: ${(e as Error).message}`)
    }

    offset += OBJECT_TYPE_DEF_LENGTH
  }

  return {
    abiManager: new AbiManager(header.obfuscationKey, header.version, Type.object, typeDefinitions),
    abiByteSize,
  }
}

export function serializeObjectAbi(abi: AbiManager<Type.object>): Uint8Array {
  const markers = abi.typeDefinitions.map(typeDef => typeDef.marker)
  const serializedMarkers = serializeMarkers(markers)

  const serializedTypeDefs: Bytes<7>[] = []
  for (const [index, typeDefinition] of abi.typeDefinitions.entries()) {
    serializedTypeDefs.push(
      new Bytes([
        typeDefinition.beeSon.abiManager.type.charCodeAt(0),
        ...serializeUint32(typeDefinition.segmentLength),
        ...serializedMarkers.serializedMarkerLengths[index],
      ]),
    )
  }
  const flattenTypeDefs = flattenBytesArray(serializedTypeDefs)
  // 4 is the bytes length of the `abiSegmentSize` and `flattenTypeDefs
  const abiSegmentSize = segmentSize(4 + flattenTypeDefs.length + serializedMarkers.serializedMarkers.length)

  const bytes = new Uint8Array([
    ...serializeUint16(abiSegmentSize),
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
