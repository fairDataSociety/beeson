import { BeeSon } from './beeson'
import { deserializeUint16, deserializeUint32, serializeUint16, serializeUint32 } from './number-serializer'
import { deserializeString, serializeString } from './string-seralizer'
import { assertBeeSonType, JsonValue, Type, ValueType } from './types'
import {
  assertArray,
  assertBigInt,
  assertBoolean,
  assertInteger,
  assertJsonValue,
  assertNumber,
  assertObject,
  assertString,
  Bytes,
  bytesToString,
  encryptDecrypt,
  equalBytes,
  flattenBytesArray,
  isNumber,
  isObject,
  keccak256Hash,
  segmentPaddingFromRight,
  SEGMENT_SIZE,
} from './utils'
import {
  assertSwarmFeedCid,
  assertSwarmManifestCid,
  isSwarmFeedCid,
  isSwarmManifestCid,
} from './address-serializer'

export const HEADER_BYTE_LENGTH = 64
const ARRAY_TYPE_DEF_LENGTH = 5
const OBJECT_TYPE_DEF_LENGTH = 7

export enum Version {
  unpackedV0_1 = 'beeson-0.1-unpacked',
}

export interface TypeDefitionA {
  /** last typedefinition segmentLength is null */
  segmentLength: number | null
  beeSon: BeeSon<JsonValue>
}

/** Type definition at Objects */
export interface TypeDefitionO extends TypeDefitionA {
  marker: string
}

interface ChildA {
  segmentLength: number | null
  abi: AbiObject<Type>
}

interface ChildO extends ChildA {
  marker: string
}

type AbiChildren<T extends Type> = T extends Type.array
  ? ChildA[]
  : T extends Type.object
  ? ChildO[]
  : undefined

interface AbiObject<T extends Type> {
  type: T
  children: AbiChildren<T>
}

interface AbiRootObject<T extends Type> extends AbiObject<T> {
  obfuscationKey: Bytes<32>
  version: Version
}

function isAbiObjectType<T extends Type>(abiObject: AbiObject<Type>, type: T): abiObject is AbiObject<T> {
  return abiObject.type === type
}

export interface Abi<T extends Type = Type> {
  obfuscationKey: Bytes<32>
  version: Version
  type: T
  /** at container types */
  typeDefinitions: T extends Type.array ? TypeDefitionA[] : T extends Type.object ? TypeDefitionO[] : unknown
}

export interface Header<T extends Type> {
  obfuscationKey: Bytes<32>
  version: Version
  type: T
}

type TypeDefinitions<T extends Type> = T extends Type.array
  ? TypeDefitionA[]
  : T extends Type.object
  ? TypeDefitionO[]
  : null

export class AbiManager<T extends Type> {
  constructor(
    public obfuscationKey: Bytes<32>,
    private _version: Version,
    private _type: T,
    private _typeDefinitions: TypeDefinitions<T>,
  ) {}

  public get version(): Version {
    return this._version
  }

  public get type(): T {
    return this._type
  }

  public get typeDefinitions(): TypeDefinitions<T> {
    return this._typeDefinitions
  }

  /**
   * Asserts whether the given JsonValue satisfies its corresponding ABI
   * Container typed values have shallow assertion as their elements will have own BeeSon object anyway.
   */
  public assertJsonValue(value: unknown): void {
    if (isAbiManagerType(this, Type.swarmCac)) {
      assertSwarmManifestCid(value)
    } else if (isAbiManagerType(this, Type.swarmSoc)) {
      assertSwarmFeedCid(value)
    } else if (isAbiManagerType(this, Type.float32) || isAbiManagerType(this, Type.float64)) {
      assertNumber(value)
    } else if (
      isAbiManagerType(this, Type.uint8) ||
      isAbiManagerType(this, Type.int8) ||
      isAbiManagerType(this, Type.int16) ||
      isAbiManagerType(this, Type.int32)
    ) {
      assertInteger(value)
    } else if (isAbiManagerType(this, Type.int64)) {
      assertBigInt(value)
    } else if (isAbiManagerType(this, Type.string)) {
      assertString(value)
    } else if (isAbiManagerType(this, Type.array)) {
      assertArray(value)
      if (value.length !== this._typeDefinitions.length) {
        throw new Error(
          `Given JSON array has ${value.length} length, when the abi defines ${this._typeDefinitions.length} length`,
        )
      }
    } else if (isAbiManagerType(this, Type.object)) {
      assertObject(value)
      const objectKeys = Object.keys(value)
      if (objectKeys.length !== this._typeDefinitions.length) {
        const typeDefKeys = this._typeDefinitions.map(def => def.marker)
        throw new Error(
          `Given JSON object has ${objectKeys.length} key length, when the abi defines ${
            this._typeDefinitions.length
          } length.\n\tMissing keys: ${objectKeys.map(k => !typeDefKeys.includes(k))}`,
        )
      }
      for (const typeDefinition of this._typeDefinitions) {
        const typeDef = typeDefinition as TypeDefitionO // TODO create typescript issue about it
        if (!objectKeys.includes(typeDef.marker)) {
          throw new Error(`Given JSON object does not have key: ${typeDef.marker}`)
        }
      }
    } else if (isAbiManagerType(this, Type.boolean)) {
      assertBoolean(value)
    }
  }

  public getAbiObject(): AbiObject<T> {
    if (isAbiManagerType(this, Type.array)) {
      return {
        type: this._type,
        children: this._typeDefinitions.map(typeDef => {
          return {
            segmentLength: typeDef.segmentLength,
            abi: typeDef.beeSon.abiManager.getAbiObject(),
          }
        }) as AbiChildren<T>,
      }
    } else if (isAbiManagerType(this, Type.object)) {
      return {
        type: this._type,
        children: this._typeDefinitions.map(typeDef => {
          return {
            segmentLength: typeDef.segmentLength,
            abi: typeDef.beeSon.abiManager.getAbiObject(),
            marker: typeDef.marker,
          }
        }) as AbiChildren<T>,
      }
    }

    return {
      type: this._type,
      children: undefined as AbiChildren<T>,
    }
  }

  /** `withoutBlobHeader` used mainly at container types */
  public serialize(withoutBlobHeader = false): Uint8Array {
    const header = withoutBlobHeader ? new Uint8Array() : this.serializeHeader()
    let data: Uint8Array

    if (isAbiManagerType(this, Type.array)) {
      data = new Uint8Array([...header, ...serializeArrayAbi(this as AbiManager<Type.array>)])
    } else if (this._type === Type.object) {
      data = new Uint8Array([...header, ...serializeObjectAbi(this as AbiManager<Type.object>)])
    } else {
      return header // no padding required
    }

    return segmentPaddingFromRight(data)
  }

  public serializeHeader(): Bytes<64> {
    const data = new Uint8Array([...serializeVersion(this._version), this._type.charCodeAt(0)])
    encryptDecrypt(this.obfuscationKey, data)

    return new Bytes([...this.obfuscationKey, ...data])
  }

  public static deserialize<T extends Type>(
    data: Uint8Array,
    header?: Header<T> | undefined,
  ): { abiManager: AbiManager<T>; processedBytes: number } {
    let processedBytes = 0
    if (!header) {
      // `data` has to have header in order to identify the beeson type, otherwise error
      header = AbiManager.deserializeHeader(data.slice(0, 64) as Bytes<64>) as Header<T>
      data = data.slice(64)
      processedBytes = 64
    }

    if (isHeaderType(header!, Type.array)) {
      const { abiManager, abiByteSize } = deserializeArrayAbi(data, header)

      return {
        abiManager: abiManager as AbiManager<T>,
        processedBytes: processedBytes + abiByteSize,
      }
    } else if (isHeaderType(header!, Type.object)) {
      const { abiManager, abiByteSize } = deserializeObjectAbi(data, header)

      return {
        abiManager: abiManager as AbiManager<T>,
        processedBytes: processedBytes + abiByteSize,
      }
    }

    return {
      abiManager: new AbiManager(
        header.obfuscationKey,
        header.version,
        header.type,
        null as TypeDefinitions<T>,
      ),
      processedBytes,
    }
  }

  private static deserializeHeader(bytes: Bytes<64>): Header<Type> {
    const obfuscationKey = bytes.slice(0, 32) as Bytes<32>
    const decryptedBytes = new Uint8Array(bytes.slice(32))
    encryptDecrypt(obfuscationKey, decryptedBytes)
    const versionHash = decryptedBytes.slice(0, 31)
    const version = Version.unpackedV0_1 // Only current version
    const type = String.fromCharCode(decryptedBytes[31]) as Type

    // version check
    if (!equalBytes(versionHash, serializeVersion(Version.unpackedV0_1))) {
      throw new Error(`Not a valid BeeSon version hash`)
    }
    // Type check
    assertBeeSonType(type)

    return {
      type,
      version,
      obfuscationKey,
    }
  }

  public static loadAbiRootObject<T extends Type>(abi: AbiRootObject<T>): AbiManager<T> {
    return AbiManager.loadAbiObject(abi, abi.obfuscationKey, abi.version)
  }

  public static loadAbiObject<T extends Type>(
    abi: AbiObject<T>,
    obfuscationKey: Bytes<32>,
    version: Version,
  ): AbiManager<T> {
    if (isAbiObjectType(abi, Type.array)) {
      const typeDefinitions: TypeDefitionA[] = abi.children.map(child => {
        return {
          segmentLength: child.segmentLength,
          beeSon: new BeeSon({
            abiManager: AbiManager.loadAbiObject(child.abi, obfuscationKey, version) as AbiManager<any>,
            obfuscationKey,
          }),
        }
      })

      return new AbiManager(obfuscationKey, version, Type.array, typeDefinitions) as AbiManager<T>
    } else if (isAbiObjectType(abi, Type.object)) {
      const typeDefinitions: TypeDefitionO[] = abi.children.map(child => {
        return {
          segmentLength: child.segmentLength,
          beeSon: new BeeSon({
            abiManager: AbiManager.loadAbiObject(child.abi, obfuscationKey, version) as AbiManager<any>,
            obfuscationKey,
          }),
          marker: child.marker,
        }
      })

      return new AbiManager(obfuscationKey, version, Type.array, typeDefinitions) as AbiManager<T>
    }

    return new AbiManager(obfuscationKey, version, abi.type, null as TypeDefinitions<T>)
  }
}

export function generateAbi<T extends JsonValue>(
  json: T,
  obfuscationKey?: Bytes<32>,
): AbiManager<ValueType<T>> {
  const type = identifyType(json)
  const version = Version.unpackedV0_1
  obfuscationKey = obfuscationKey || new Bytes(32)

  if (type === Type.array) {
    const jsonArray = json as Array<unknown>
    const typeDefinitions: TypeDefitionA[] = []

    for (const value of jsonArray) {
      assertJsonValue(value)
      const beeSon = new BeeSon({ json: value })
      const segmentLength = Math.ceil(beeSon.serialize({ withoutBlobHeader: true }).length / SEGMENT_SIZE)
      typeDefinitions.push({ beeSon, segmentLength })
    }

    return new AbiManager(obfuscationKey, version, type, typeDefinitions as TypeDefinitions<ValueType<T>>)
  } else if (type === Type.object) {
    const jsonObject = json as Record<string, unknown>
    const markerArray: string[] = Object.keys(jsonObject).sort()
    const typeDefinitions: TypeDefitionO[] = []

    for (const marker of markerArray) {
      const value = jsonObject[marker]
      assertJsonValue(value)
      const beeSon = new BeeSon({ json: value })
      const segmentLength = Math.ceil(beeSon.serialize({ withoutBlobHeader: true }).length / SEGMENT_SIZE)
      typeDefinitions.push({ beeSon, segmentLength, marker })
    }

    return new AbiManager(obfuscationKey, version, type, typeDefinitions as TypeDefinitions<ValueType<T>>)
  }

  return new AbiManager(obfuscationKey, version, type, null as TypeDefinitions<ValueType<T>>)
}

export function isAbiManagerType<T extends Type>(
  abiManager: AbiManager<Type>,
  type: T,
): abiManager is AbiManager<T> {
  return abiManager.type === type
}

function isHeaderType<T extends Type>(header: Header<Type>, type: T): header is Header<T> {
  return header.type === type
}

function identifyType<T extends JsonValue>(json: T): ValueType<T> {
  let type: Type | undefined
  // Misc types
  if (isSwarmFeedCid(json)) {
    type = Type.swarmSoc
  } else if (isSwarmManifestCid(json)) {
    type = Type.swarmCac
  } else if (typeof json === 'boolean') {
    type = Type.boolean
  } // container types
  else if (Array.isArray(json)) {
    type = Type.array
  } else if (isObject(json)) {
    type = Type.object
  } else if (typeof json === 'bigint') {
    type = Type.int64
  } else if (isNumber(json)) {
    const num = Number(json)
    // number types
    if (Number.isInteger(num)) {
      // default type for integer numbers
      type = Type.int32
    } else {
      // default type for floating numbers
      type = Type.float64
    }
  } else if (typeof json === 'string') {
    type = Type.string
  }

  if (!type) {
    throw Error(`the passed JSON value cannot be identified`)
  }

  return type as ValueType<T>
}

function serializeArrayAbi(abi: AbiManager<Type.array>): Uint8Array {
  const serializedTypeDefs: Bytes<5>[] = []
  let startSegmentIndex = 0
  for (const typeDefinition of abi.typeDefinitions) {
    serializedTypeDefs.push(
      new Bytes([typeDefinition.beeSon.abiManager.type.charCodeAt(0), ...serializeUint32(startSegmentIndex)]),
    )
    startSegmentIndex += typeDefinition.segmentLength!
  }
  const flattenTypeDefs = flattenBytesArray(serializedTypeDefs)
  // 4 is the bytes length of the `abiSegmentSize` and `flattenTypeDefs
  const abiSegmentSize = segmentSize(4 + flattenTypeDefs.length)

  const bytes = new Uint8Array([
    ...serializeUint16(abiSegmentSize),
    ...serializeUint16(abi.typeDefinitions.length),
    ...flattenTypeDefs,
  ])

  encryptDecrypt(abi.obfuscationKey, bytes)

  return bytes
}

/**
 *
 * @param data raw beeson array ABI data without the blob header
 * @param header blob header of the beeson data
 * @returns
 */
function deserializeArrayAbi(
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
  const typeDefinitions: TypeDefitionA[] = []
  while (offset < ARRAY_TYPE_DEF_LENGTH * (flattenTypeDefsLength - 1)) {
    const type = String.fromCharCode(data.slice(offset, offset + 1)[0])
    const startSegmentIndex = deserializeUint32(data.slice(offset + 1, offset + 5) as Bytes<4>)
    const nextOffset = offset + ARRAY_TYPE_DEF_LENGTH
    const endSegmentIndex = deserializeUint32(data.slice(nextOffset + 1, nextOffset + 5) as Bytes<4>)

    try {
      assertBeeSonType(type)

      // if deserialized type is container type, then its abi has to be deserialized in a different function call
      const abiManager = new AbiManager(header.obfuscationKey, header.version, type, null)
      typeDefinitions.push({
        segmentLength: endSegmentIndex - startSegmentIndex,
        beeSon: new BeeSon({ abiManager }),
      })
    } catch (e) {
      throw new Error(`Error at BeeSon array deserialization at offset ${offset}: ${(e as Error).message}`)
    }

    offset += ARRAY_TYPE_DEF_LENGTH
  }
  // last item typedef
  if (flattenTypeDefsLength > 0) {
    const type = String.fromCharCode(data.slice(offset, offset + 1)[0])
    // const startSegmentIndex = deserializeUint32(data.slice(offset + 1, offset + 5) as Bytes<4>)

    try {
      assertBeeSonType(type)

      // if deserialized type is container type, then its abi has to be deserialized in a different function call
      const abiManager = new AbiManager(header.obfuscationKey, header.version, type, null)
      typeDefinitions.push({
        segmentLength: null,
        beeSon: new BeeSon({ abiManager }),
      })
    } catch (e) {
      throw new Error(`Error at BeeSon array deserialization at offset ${offset}: ${(e as Error).message}`)
    }
  }

  return {
    abiManager: new AbiManager(header.obfuscationKey, header.version, Type.array, typeDefinitions),
    abiByteSize,
  }
}

function deserializeObjectAbi(
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
  const typeDefinitions: TypeDefitionO[] = []
  while (offset < OBJECT_TYPE_DEF_LENGTH * (flattenTypeDefsLength - 1)) {
    const type = String.fromCharCode(data.slice(offset, offset + 1)[0])
    const startSegmentIndex = deserializeUint32(data.slice(offset + 1, offset + 5) as Bytes<4>)
    const markerIndex = deserializeUint16(data.slice(offset + 5, offset + 7) as Bytes<2>)

    const nextOffset = offset + OBJECT_TYPE_DEF_LENGTH
    const endSegmentIndex = deserializeUint32(data.slice(nextOffset + 1, nextOffset + 5) as Bytes<4>)
    const endMarkerIndex = deserializeUint16(data.slice(nextOffset + 5, nextOffset + 7) as Bytes<2>)

    const marker = bytesToString(
      data.slice(startMarkerByteIndex + markerIndex, startMarkerByteIndex + endMarkerIndex),
    )

    try {
      assertBeeSonType(type)

      // if deserialized type is container type, then its abi has to be deserialized in a different function call
      const abiManager = new AbiManager(header.obfuscationKey, header.version, type, null)
      typeDefinitions.push({
        segmentLength: endSegmentIndex - startSegmentIndex,
        beeSon: new BeeSon({ abiManager }),
        marker,
      })
    } catch (e) {
      throw new Error(`Error at BeeSon array deserialization at offset ${offset}: ${(e as Error).message}`)
    }

    offset += OBJECT_TYPE_DEF_LENGTH
  }
  // last item typedef
  if (flattenTypeDefsLength > 0) {
    const type = String.fromCharCode(data.slice(offset, offset + 1)[0])
    const markerIndex = deserializeUint16(data.slice(offset + 5, offset + 7) as Bytes<2>)
    const marker = deserializeString(data.slice(startMarkerByteIndex + markerIndex, abiByteSize))

    try {
      assertBeeSonType(type)

      // if deserialized type is container type, then its abi has to be deserialized in a different function call
      const abiManager = new AbiManager(header.obfuscationKey, header.version, type, null)
      typeDefinitions.push({
        segmentLength: null,
        beeSon: new BeeSon({ abiManager }),
        marker,
      })
    } catch (e) {
      throw new Error(`Error at BeeSon array deserialization at offset ${offset}: ${(e as Error).message}`)
    }
  }

  return {
    abiManager: new AbiManager(header.obfuscationKey, header.version, Type.object, typeDefinitions),
    abiByteSize,
  }
}

function serializeObjectAbi(abi: AbiManager<Type.object>): Uint8Array {
  const markers = abi.typeDefinitions.map(typeDef => typeDef.marker)
  const serializedMarkers = serializeMarkers(markers)

  const serializedTypeDefs: Bytes<7>[] = []
  let startSegmentIndex = 0
  for (const [index, typeDefinition] of abi.typeDefinitions.entries()) {
    serializedTypeDefs.push(
      new Bytes([
        typeDefinition.beeSon.abiManager.type.charCodeAt(0),
        ...serializeUint32(startSegmentIndex),
        ...serializedMarkers.serializedMarkerIndices[index],
      ]),
    )
    startSegmentIndex += typeDefinition.segmentLength!
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

  encryptDecrypt(abi.obfuscationKey, bytes)

  return bytes
}

type SerializedMarkers = { serializedMarkerIndices: Bytes<2>[]; serializedMarkers: Uint8Array }

function serializeMarkers(markers: string[]): SerializedMarkers {
  const serializedMarkers = serializeString(markers.join(''))
  const serializedMarkerIndices: Bytes<2>[] = []
  let keyByteOffset = 0
  for (const key of markers) {
    serializedMarkerIndices.push(serializeUint16(keyByteOffset))
    keyByteOffset += key.length
  }

  return {
    serializedMarkerIndices,
    serializedMarkers,
  }
}

function segmentSize(bytesLength: number): number {
  return Math.ceil(bytesLength / SEGMENT_SIZE)
}

function serializeVersion(version: Version): Bytes<31> {
  return keccak256Hash(version).slice(0, 31) as Bytes<31>
}
