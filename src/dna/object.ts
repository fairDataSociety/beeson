import { DnaManager, Header, TypeDefinitionO } from '.'
import { BeeSon } from '../beeson'
import { Type, assertBeeSonType } from '../types'
import { BitVector } from '../bitvector'
import {
  deserializeUint16,
  deserializeUint32,
  serializeUint16,
  serializeUint32,
} from '../marshalling/number-serializer'
import { serializeString } from '../marshalling/string-seralizer'
import { Bytes, bytesToString, encryptDecrypt, flattenBytesArray, segmentSize } from '../utils'

const OBJECT_TYPE_DEF_LENGTH = 7

export function dnaNullableObject(dna: DnaManager<Type.nullableObject>): Uint8Array {
  const markers = dna.typeDefinitions.map(typeDef => typeDef.marker)
  const serializedMarkers = serializeMarkers(markers)
  const bv = new BitVector(dna.typeDefinitions.length)

  const serializedTypeDefs: Bytes<7>[] = []
  for (const [index, typeDefinition] of dna.typeDefinitions.entries()) {
    serializedTypeDefs.push(
      new Bytes([
        typeDefinition.beeSon.dnaManager.type,
        ...serializeUint32(typeDefinition.segmentLength),
        ...serializedMarkers.serializedMarkerLengths[index],
      ]),
    )
    if (typeDefinition.beeSon.dnaManager.nullable) {
      bv.setBit(index)
    }
  }
  const flattenTypeDefs = flattenBytesArray(serializedTypeDefs)
  // 6 is the bytes length of the `dnaSegmentSize`, `flattenTypeDefs` and the `serializedMarkers.length`
  const dnaSegmentSize = segmentSize(
    6 + flattenTypeDefs.length + serializedMarkers.serializedMarkers.length + bv.bitVector.length,
  )

  const bytes = new Uint8Array([
    ...serializeUint16(dnaSegmentSize),
    ...serializeUint16(serializedTypeDefs.length),
    ...serializeUint16(serializedMarkers.serializedMarkers.length),
    ...flattenBytesArray(serializedTypeDefs),
    ...serializedMarkers.serializedMarkers,
    ...bv.bitVector,
  ])

  return bytes
}

export function spawnNullableObject(
  data: Uint8Array,
  header: Header<Type.nullableObject>,
): { dnaManager: DnaManager<Type.nullableObject>; dnaByteSize: number } {
  encryptDecrypt(header.obfuscationKey, data)

  let offset = 0
  const dnaSegmentSize = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
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
  const dnaByteSize = dnaSegmentSize * 32
  const startMarkerByteIndex = offset + flattenTypeDefsLength * OBJECT_TYPE_DEF_LENGTH
  const typeDefinitions: TypeDefinitionO[] = []
  let i = 0
  let markerOffset = 0
  while (offset < OBJECT_TYPE_DEF_LENGTH * flattenTypeDefsLength) {
    const type = data.slice(offset, offset + 1)[0]
    const segmentLength = deserializeUint32(data.slice(offset + 1, offset + 5) as Bytes<4>)

    const markerLength = deserializeUint16(data.slice(offset + 5, offset + 7) as Bytes<2>)
    const marker = bytesToString(
      data.slice(startMarkerByteIndex + markerOffset, startMarkerByteIndex + markerOffset + markerLength),
    )
    markerOffset += markerLength

    try {
      assertBeeSonType(type)

      // if deserialized type is container type, then its dna has to be deserialized in a different function call
      const dnaManager = new DnaManager(
        header.obfuscationKey,
        header.version,
        type,
        null,
        bitVector.getBit(i),
      )
      typeDefinitions.push({
        segmentLength,
        beeSon: new BeeSon({ dnaManager }),
        marker,
      })
    } catch (e) {
      throw new Error(`Error at BeeSon array deserialization at offset ${offset}: ${(e as Error).message}`)
    }

    offset += OBJECT_TYPE_DEF_LENGTH
    i++
  }

  return {
    dnaManager: new DnaManager(header.obfuscationKey, header.version, Type.nullableObject, typeDefinitions),
    dnaByteSize,
  }
}

export function spawnObject(
  data: Uint8Array,
  header: Header<Type.object>,
): { dnaManager: DnaManager<Type.object>; dnaByteSize: number } {
  encryptDecrypt(header.obfuscationKey, data)

  let offset = 0
  const dnaSegmentSize = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
  offset += 2
  const flattenTypeDefsLength = deserializeUint16(data.slice(offset, offset + 2) as Bytes<2>)
  offset += 2

  // deserialize typedefs
  const dnaByteSize = dnaSegmentSize * 32
  const startMarkerByteIndex = offset + flattenTypeDefsLength * OBJECT_TYPE_DEF_LENGTH
  const typeDefinitions: TypeDefinitionO[] = []
  let markerOffset = 0
  while (offset < OBJECT_TYPE_DEF_LENGTH * flattenTypeDefsLength) {
    const type = data.slice(offset, offset + 1)[0]
    const segmentLength = deserializeUint32(data.slice(offset + 1, offset + 5) as Bytes<4>)

    const markerLength = deserializeUint16(data.slice(offset + 5, offset + 7) as Bytes<2>)
    const marker = bytesToString(
      data.slice(startMarkerByteIndex + markerOffset, startMarkerByteIndex + markerOffset + markerLength),
    )
    markerOffset += markerLength

    try {
      assertBeeSonType(type)

      // if deserialized type is container type, then its dna has to be deserialized in a different function call
      const dnaManager = new DnaManager(header.obfuscationKey, header.version, type, null)
      typeDefinitions.push({
        segmentLength,
        beeSon: new BeeSon({ dnaManager }),
        marker,
      })
    } catch (e) {
      throw new Error(`Error at BeeSon array deserialization at offset ${offset}: ${(e as Error).message}`)
    }

    offset += OBJECT_TYPE_DEF_LENGTH
  }

  return {
    dnaManager: new DnaManager(header.obfuscationKey, header.version, Type.object, typeDefinitions),
    dnaByteSize,
  }
}

export function dnaObject(dna: DnaManager<Type.object>): Uint8Array {
  const markers = dna.typeDefinitions.map(typeDef => typeDef.marker)
  const serializedMarkers = serializeMarkers(markers)

  const serializedTypeDefs: Bytes<7>[] = []
  for (const [index, typeDefinition] of dna.typeDefinitions.entries()) {
    serializedTypeDefs.push(
      new Bytes([
        typeDefinition.beeSon.dnaManager.type,
        ...serializeUint32(typeDefinition.segmentLength),
        ...serializedMarkers.serializedMarkerLengths[index],
      ]),
    )
  }
  const flattenTypeDefs = flattenBytesArray(serializedTypeDefs)
  // 4 is the bytes length of the `dnaSegmentSize` and `flattenTypeDefs
  const dnaSegmentSize = segmentSize(4 + flattenTypeDefs.length + serializedMarkers.serializedMarkers.length)

  const bytes = new Uint8Array([
    ...serializeUint16(dnaSegmentSize),
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
