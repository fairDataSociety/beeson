import { BeeSon } from '../beeson'
import { assertBeeSonType, JsonValue, Type, ValueType } from '../types'
import {
  assertArray,
  assertBigInt,
  assertBoolean,
  assertInteger,
  assertJsonValue,
  assertNull,
  assertNumber,
  assertObject,
  assertString,
  Bytes,
  encryptDecrypt,
  equalBytes,
  isNull,
  isNumber,
  isObject,
  keccak256Hash,
  segmentPaddingFromRight,
  SEGMENT_SIZE,
} from '../utils'
import {
  assertSwarmFeedCid,
  assertSwarmManifestCid,
  isSwarmFeedCid,
  isSwarmManifestCid,
} from '../marshalling/address-serializer'
import {
  deserializeArrayAbi,
  deserializeNullableArrayAbi,
  serializeArrayAbi,
  serializeNullableArrayAbi,
} from './array'
import {
  deserializeNullableObjectAbi,
  deserializeObjectAbi,
  serializeNullableObjectAbi,
  serializeObjectAbi,
} from './object'

export const HEADER_BYTE_LENGTH = 64

export enum Version {
  unpackedV0_1 = 'beeson-0.1-unpacked',
}

export interface TypeDefinitionA {
  segmentLength: number
  beeSon: BeeSon<JsonValue>
}

/** Type definition at Objects */
export interface TypeDefinitionO extends TypeDefinitionA {
  marker: string
}

interface ChildA {
  segmentLength: number
  abi: AbiObject<Type>
}

interface ChildANullable extends ChildA {
  nullable: boolean
}

interface ChildO extends ChildA {
  marker: string
}

interface ChildONullable extends ChildO {
  nullable: boolean
}

type AbiChildren<T extends Type> = T extends Type.array
  ? ChildA[]
  : T extends Type.nullableArray
  ? ChildANullable[]
  : T extends Type.object
  ? ChildO[]
  : T extends Type.nullableObject
  ? ChildONullable[]
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
  typeDefinitions: T extends Type.array
    ? TypeDefinitionA[]
    : T extends Type.object
    ? TypeDefinitionO[]
    : unknown
}

export interface Header<T extends Type> {
  obfuscationKey: Bytes<32>
  version: Version
  type: T
}

type TypeDefinitions<T extends Type> = T extends Type.array | Type.nullableArray
  ? TypeDefinitionA[]
  : T extends Type.object | Type.nullableObject
  ? TypeDefinitionO[]
  : null

type NullableContainerAbiManager<T extends Type> = T extends Type.array
  ? AbiManager<Type.nullableArray>
  : T extends Type.object
  ? AbiManager<Type.nullableObject>
  : never

export class AbiManager<T extends Type> {
  constructor(
    public obfuscationKey: Bytes<32>,
    private _version: Version,
    private _type: T,
    private _typeDefinitions: TypeDefinitions<T>,
    /** if the JSONValue is nullable according to its parent container's field defintion */
    public readonly nullable = false,
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
  // eslint-disable-next-line complexity
  public assertJsonValue(value: unknown): asserts value is JsonValue {
    if (this.nullable && isNull(value)) return
    if (isAbiManagerType(this, Type.swarmCac)) {
      return assertSwarmManifestCid(value)
    }
    if (isAbiManagerType(this, Type.swarmSoc)) {
      return assertSwarmFeedCid(value)
    }
    if (isAbiManagerType(this, Type.float32) || isAbiManagerType(this, Type.float64)) {
      return assertNumber(value)
    }
    if (
      isAbiManagerType(this, Type.uint8) ||
      isAbiManagerType(this, Type.int8) ||
      isAbiManagerType(this, Type.int16) ||
      isAbiManagerType(this, Type.int32)
    ) {
      return assertInteger(value)
    }
    if (isAbiManagerType(this, Type.int64)) {
      return assertBigInt(value)
    }
    if (isAbiManagerType(this, Type.string)) {
      return assertString(value)
    }
    if (isAbiManagerType(this, Type.array) || isAbiManagerType(this, Type.nullableArray)) {
      assertArray(value)
      const typeDefs = this.typeDefinitions as TypeDefinitionA[]
      if (value.length !== typeDefs.length) {
        throw new Error(
          `Given JSON array has ${value.length} length, when the abi defines ${typeDefs.length} length`,
        )
      }

      return
    }
    if (isAbiManagerType(this, Type.object) || isAbiManagerType(this, Type.nullableObject)) {
      assertObject(value)
      const objectKeys = Object.keys(value)
      const typeDefs = this.typeDefinitions as TypeDefinitionO[]
      if (objectKeys.length !== typeDefs.length) {
        const typeDefKeys = typeDefs.map(def => def.marker)
        throw new Error(
          `Given JSON object has ${objectKeys.length} key length, when the abi defines ${
            typeDefs.length
          } length.\n\tMissing keys: ${typeDefKeys.filter(k => !objectKeys.includes(k))}`,
        )
      }
      for (const typeDefinition of typeDefs) {
        if (!objectKeys.includes(typeDefinition.marker)) {
          throw new Error(`Given JSON object does not have key: ${typeDefinition.marker}`)
        }
      }

      return
    }
    if (isAbiManagerType(this, Type.boolean)) {
      return assertBoolean(value)
    }
    if (isAbiManagerType(this, Type.null)) {
      return assertNull(value)
    }

    throw new Error(`ABI assertion problem at value "${value}". There is no corresponding check`)
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
    } else if (isAbiManagerType(this, Type.nullableArray)) {
      return {
        type: this._type,
        children: this._typeDefinitions.map(typeDef => {
          return {
            segmentLength: typeDef.segmentLength,
            abi: typeDef.beeSon.abiManager.getAbiObject(),
            nullable: typeDef.beeSon.abiManager.nullable,
          }
        }) as AbiChildren<T>,
      }
    } else if (isAbiManagerType(this, Type.nullableObject)) {
      return {
        type: this._type,
        children: this._typeDefinitions.map(typeDef => {
          return {
            segmentLength: typeDef.segmentLength,
            abi: typeDef.beeSon.abiManager.getAbiObject(),
            nullable: typeDef.beeSon.abiManager.nullable,
            marker: typeDef.marker,
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
    let abi: Uint8Array

    if (isAbiManagerType(this, Type.array)) {
      abi = serializeArrayAbi(this as AbiManager<Type.array>)
    } else if (this._type === Type.object) {
      abi = serializeObjectAbi(this as AbiManager<Type.object>)
    } else if (this._type === Type.nullableArray) {
      abi = serializeNullableArrayAbi(this as AbiManager<Type.nullableArray>)
    } else if (this._type === Type.nullableObject) {
      abi = serializeNullableObjectAbi(this as AbiManager<Type.nullableObject>)
    } else {
      return header // no padding required
    }
    abi = segmentPaddingFromRight(abi)
    encryptDecrypt(this.obfuscationKey, abi)

    return new Uint8Array([...header, ...abi])
  }

  public serializeHeader(): Bytes<64> {
    const data = new Uint8Array([...serializeVersion(this._version), this._type])
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
    } else if (isHeaderType(header!, Type.nullableArray)) {
      const { abiManager, abiByteSize } = deserializeNullableArrayAbi(data, header)

      return {
        abiManager: abiManager as AbiManager<T>,
        processedBytes: processedBytes + abiByteSize,
      }
    } else if (isHeaderType(header!, Type.nullableObject)) {
      const { abiManager, abiByteSize } = deserializeNullableObjectAbi(data, header)

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
    const type = decryptedBytes[31] as Type

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
    obfuscationKey: Bytes<32> = new Bytes(32),
    version = Version.unpackedV0_1,
    nullable = false,
  ): AbiManager<T> {
    assertObfuscationKey(obfuscationKey)
    assertVersion(version)

    if (isAbiObjectType(abi, Type.array)) {
      const typeDefinitions: TypeDefinitionA[] = abi.children.map(child => {
        return {
          segmentLength: child.segmentLength,
          beeSon: new BeeSon({
            abiManager: AbiManager.loadAbiObject(child.abi, obfuscationKey, version) as AbiManager<any>,
            obfuscationKey,
          }),
        }
      })

      return new AbiManager(obfuscationKey, version, Type.array, typeDefinitions, nullable) as AbiManager<T>
    } else if (isAbiObjectType(abi, Type.nullableArray)) {
      const typeDefinitions: TypeDefinitionA[] = abi.children.map(child => {
        return {
          segmentLength: child.segmentLength,
          beeSon: new BeeSon({
            abiManager: AbiManager.loadAbiObject(
              child.abi,
              obfuscationKey,
              version,
              child.nullable,
            ) as AbiManager<any>,
            obfuscationKey,
          }),
        }
      })

      return new AbiManager(
        obfuscationKey,
        version,
        Type.nullableArray,
        typeDefinitions,
        nullable,
      ) as AbiManager<T>
    } else if (isAbiObjectType(abi, Type.object)) {
      const typeDefinitions: TypeDefinitionO[] = abi.children.map(child => {
        return {
          segmentLength: child.segmentLength,
          beeSon: new BeeSon({
            abiManager: AbiManager.loadAbiObject(child.abi, obfuscationKey, version) as AbiManager<any>,
            obfuscationKey,
          }),
          marker: child.marker,
        }
      })

      return new AbiManager(obfuscationKey, version, Type.object, typeDefinitions, nullable) as AbiManager<T>
    } else if (isAbiObjectType(abi, Type.nullableObject)) {
      const typeDefinitions: TypeDefinitionO[] = abi.children.map(child => {
        return {
          segmentLength: child.segmentLength,
          beeSon: new BeeSon({
            abiManager: AbiManager.loadAbiObject(
              child.abi,
              obfuscationKey,
              version,
              child.nullable,
            ) as AbiManager<any>,
            obfuscationKey,
          }),
          marker: child.marker,
        }
      })

      return new AbiManager(
        obfuscationKey,
        version,
        Type.nullableObject,
        typeDefinitions,
        nullable,
      ) as AbiManager<T>
    }

    return new AbiManager(obfuscationKey, version, abi.type, null as TypeDefinitions<T>, nullable)
  }

  // mutate methods

  /**
   * Set container object element nullable or disallow to be that
   * @throws if the stored json value of the element has conflict with the nullable abi parameter
   * | (e.g.) ABI was nullable before and the json value null, and user changes nullable to false
   */
  public setTypeDefinitionNullable(typeDefIndex: number, nullable: boolean) {
    if (!this._typeDefinitions) throw new Error(`ABI does not handle a container type`)
    if (!isAbiManagerType(this, Type.nullableArray) && !isAbiManagerType(this, Type.nullableObject)) {
      throw new Error(`ABI does not handle nullable container here`)
    }
    if (!this.typeDefinitions[typeDefIndex]) {
      throw new Error(`there is no typedefintion on index ${typeDefIndex}`)
    }
    const oldBeeSon = this.typeDefinitions[typeDefIndex].beeSon
    const oldAbiManager = oldBeeSon.abiManager
    const oldTypeDefs = Array.isArray(oldAbiManager.typeDefinitions)
      ? [...oldAbiManager.typeDefinitions]
      : oldAbiManager.typeDefinitions
    const newAbiManager = new AbiManager(
      oldAbiManager.obfuscationKey,
      oldAbiManager.version,
      oldAbiManager.type,
      oldTypeDefs,
      nullable,
    )
    const newBeeSon = new BeeSon({ abiManager: newAbiManager })
    newBeeSon.json = oldBeeSon.json
    //overwrite new beeson object for element
    this.typeDefinitions[typeDefIndex].beeSon = newBeeSon
  }

  public getNullableContainerAbiManager(): NullableContainerAbiManager<T> {
    if (isAbiManagerType(this, Type.array)) {
      const typeDefinitions = this._typeDefinitions.map(oldTypeDef => {
        const oldBeeSon = oldTypeDef.beeSon
        const oldAbiManager = oldBeeSon.abiManager
        const newAbiManager = new AbiManager(
          oldAbiManager.obfuscationKey,
          oldAbiManager.version,
          oldAbiManager.type,
          oldAbiManager.typeDefinitions,
          true,
        )
        const newBeeSon = new BeeSon({ abiManager: newAbiManager })
        const newTypeDef: TypeDefinitionA = {
          segmentLength: oldTypeDef.segmentLength,
          beeSon: newBeeSon,
        }

        return newTypeDef
      })

      return new AbiManager(
        this.obfuscationKey,
        this.version,
        Type.nullableArray,
        typeDefinitions,
      ) as NullableContainerAbiManager<T>
    }
    if (isAbiManagerType(this, Type.object)) {
      const typeDefinitions = this._typeDefinitions.map(oldTypeDef => {
        const oldBeeSon = oldTypeDef.beeSon
        const oldAbiManager = oldBeeSon.abiManager
        const newAbiManager = new AbiManager(
          oldAbiManager.obfuscationKey,
          oldAbiManager.version,
          oldAbiManager.type,
          oldAbiManager.typeDefinitions,
          true,
        )
        const newBeeSon = new BeeSon({ abiManager: newAbiManager })
        const newTypeDef: TypeDefinitionO = {
          ...oldTypeDef,
          beeSon: newBeeSon,
        }

        return newTypeDef
      })

      return new AbiManager(
        this.obfuscationKey,
        this.version,
        Type.nullableObject,
        typeDefinitions,
      ) as NullableContainerAbiManager<T>
    }

    throw new Error(`This ABI does not represent a nullable container value`)
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
    const typeDefinitions: TypeDefinitionA[] = []

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
    const typeDefinitions: TypeDefinitionO[] = []

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

/** does not set nullable types by default. */
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

function serializeVersion(version: Version): Bytes<31> {
  return keccak256Hash(version).slice(0, 31) as Bytes<31>
}

function isObfuscationKey(value: unknown): value is Bytes<32> {
  return value instanceof Uint8Array && value.length === 32
}

function assertObfuscationKey(value: unknown): asserts value is Bytes<32> {
  if (!isObfuscationKey(value)) throw new Error(`Not valid obfuscation key: ${value}`)
}

function isVersion(value: unknown): value is Version {
  return Object.values(Version).includes(value as Version)
}

function assertVersion(value: unknown): asserts value is Version {
  if (!isVersion) throw new Error(`Not valid BeeSon version: ${value}`)
}
