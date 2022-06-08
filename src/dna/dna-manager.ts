import { BeeSon } from '../beeson'
import { assertBeeSonType, deserializeType, JsonValue, serializeType, Type, ValueType } from '../types'
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
  segmentPaddingFromRight,
  SEGMENT_SIZE,
} from '../utils'
import {
  assertSwarmFeedCid,
  assertSwarmManifestCid,
  isSwarmFeedCid,
  isSwarmManifestCid,
} from '../marshalling/address-serializer'
import { spawnArray, spawnNullableArray, dnaArray, dnaNullableArray } from './array'
import { spawnNullableObject, spawnObject, dnaNullableObject, dnaObject } from './object'

export const HEADER_BYTE_LENGTH = 64
const BEESON_HEADER_ID = 1

export enum Version {
  unpackedV0_1 = '0.1.0',
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
  dna: DnaObject<Type>
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

type DnaChildren<T extends Type> = T extends Type.array
  ? ChildA[]
  : T extends Type.nullableArray
  ? ChildANullable[]
  : T extends Type.object
  ? ChildO[]
  : T extends Type.nullableObject
  ? ChildONullable[]
  : undefined

interface DnaObject<T extends Type> {
  type: T
  children: DnaChildren<T>
}

interface DnaRootObject<T extends Type> extends DnaObject<T> {
  obfuscationKey: Bytes<32>
  version: Version
}

function isDnaObjectType<T extends Type>(dnaObject: DnaObject<Type>, type: T): dnaObject is DnaObject<T> {
  return dnaObject.type === type
}

export interface Dna<T extends Type = Type> {
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

type NullableContainerDnaManager<T extends Type> = T extends Type.array
  ? DnaManager<Type.nullableArray>
  : T extends Type.object
  ? DnaManager<Type.nullableObject>
  : never

export class DnaManager<T extends Type> {
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
   * Asserts whether the given JsonValue satisfies its corresponding DNA
   * Container typed values have shallow assertion as their elements will have own BeeSon object anyway.
   */
  // eslint-disable-next-line complexity
  public assertJsonValue(value: unknown): asserts value is JsonValue {
    if (this.nullable && isNull(value)) return
    if (isDnaManagerType(this, Type.swarmCac)) {
      return assertSwarmManifestCid(value)
    }
    if (isDnaManagerType(this, Type.swarmSoc)) {
      return assertSwarmFeedCid(value)
    }
    if (isDnaManagerType(this, Type.float32) || isDnaManagerType(this, Type.float64)) {
      return assertNumber(value)
    }
    if (
      isDnaManagerType(this, Type.uint8) ||
      isDnaManagerType(this, Type.int8) ||
      isDnaManagerType(this, Type.int16) ||
      isDnaManagerType(this, Type.int32)
    ) {
      return assertInteger(value)
    }
    if (isDnaManagerType(this, Type.int64)) {
      return assertBigInt(value)
    }
    if (isDnaManagerType(this, Type.string)) {
      return assertString(value)
    }
    if (isDnaManagerType(this, Type.array) || isDnaManagerType(this, Type.nullableArray)) {
      assertArray(value)
      const typeDefs = this.typeDefinitions as TypeDefinitionA[]
      if (value.length !== typeDefs.length) {
        throw new Error(
          `Given JSON array has ${value.length} length, when the dna defines ${typeDefs.length} length`,
        )
      }

      return
    }
    if (isDnaManagerType(this, Type.object) || isDnaManagerType(this, Type.nullableObject)) {
      assertObject(value)
      const objectKeys = Object.keys(value)
      const typeDefs = this.typeDefinitions as TypeDefinitionO[]
      if (objectKeys.length !== typeDefs.length) {
        const typeDefKeys = typeDefs.map(def => def.marker)
        throw new Error(
          `Given JSON object has ${objectKeys.length} key length, when the dna defines ${
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
    if (isDnaManagerType(this, Type.boolean)) {
      return assertBoolean(value)
    }
    if (isDnaManagerType(this, Type.null)) {
      return assertNull(value)
    }

    throw new Error(`DNA assertion problem at value "${value}". There is no corresponding check`)
  }

  public getDnaObject(): DnaObject<T> {
    if (isDnaManagerType(this, Type.array)) {
      return {
        type: this._type,
        children: this._typeDefinitions.map(typeDef => {
          return {
            segmentLength: typeDef.segmentLength,
            dna: typeDef.beeSon.dnaManager.getDnaObject(),
          }
        }) as DnaChildren<T>,
      }
    } else if (isDnaManagerType(this, Type.nullableArray)) {
      return {
        type: this._type,
        children: this._typeDefinitions.map(typeDef => {
          return {
            segmentLength: typeDef.segmentLength,
            dna: typeDef.beeSon.dnaManager.getDnaObject(),
            nullable: typeDef.beeSon.dnaManager.nullable,
          }
        }) as DnaChildren<T>,
      }
    } else if (isDnaManagerType(this, Type.nullableObject)) {
      return {
        type: this._type,
        children: this._typeDefinitions.map(typeDef => {
          return {
            segmentLength: typeDef.segmentLength,
            dna: typeDef.beeSon.dnaManager.getDnaObject(),
            nullable: typeDef.beeSon.dnaManager.nullable,
            marker: typeDef.marker,
          }
        }) as DnaChildren<T>,
      }
    } else if (isDnaManagerType(this, Type.object)) {
      return {
        type: this._type,
        children: this._typeDefinitions.map(typeDef => {
          return {
            segmentLength: typeDef.segmentLength,
            dna: typeDef.beeSon.dnaManager.getDnaObject(),
            marker: typeDef.marker,
          }
        }) as DnaChildren<T>,
      }
    }

    return {
      type: this._type,
      children: undefined as DnaChildren<T>,
    }
  }

  /** `withoutBlobHeader` used mainly at container types */
  public dna(withoutBlobHeader = false): Uint8Array {
    const header = withoutBlobHeader ? new Uint8Array() : this.dnaHeader()
    let dna: Uint8Array

    if (isDnaManagerType(this, Type.array)) {
      dna = dnaArray(this as DnaManager<Type.array>)
    } else if (this._type === Type.object) {
      dna = dnaObject(this as DnaManager<Type.object>)
    } else if (this._type === Type.nullableArray) {
      dna = dnaNullableArray(this as DnaManager<Type.nullableArray>)
    } else if (this._type === Type.nullableObject) {
      dna = dnaNullableObject(this as DnaManager<Type.nullableObject>)
    } else {
      return header // no padding required
    }
    dna = segmentPaddingFromRight(dna)
    encryptDecrypt(this.obfuscationKey, dna)

    return new Uint8Array([...header, ...dna])
  }

  public dnaHeader(): Bytes<64> {
    const data = new Uint8Array([
      ...serializeVersion(this._version),
      ...new Uint8Array(26),
      ...serializeType(this._type),
    ]) // should be 32 bytes
    encryptDecrypt(this.obfuscationKey, data)

    return new Bytes([...this.obfuscationKey, ...data])
  }

  public static spawn<T extends Type>(
    data: Uint8Array,
    header?: Header<T> | undefined,
  ): { dnaManager: DnaManager<T>; processedBytes: number } {
    let processedBytes = 0
    if (!header) {
      // `data` has to have header in order to identify the beeson type, otherwise error
      header = DnaManager.spawnHeader(data.slice(0, 64) as Bytes<64>) as Header<T>
      data = data.slice(64)
      processedBytes = 64
    }

    if (isHeaderType(header!, Type.array)) {
      const { dnaManager, dnaByteSize } = spawnArray(data, header)

      return {
        dnaManager: dnaManager as DnaManager<T>,
        processedBytes: processedBytes + dnaByteSize,
      }
    } else if (isHeaderType(header!, Type.object)) {
      const { dnaManager, dnaByteSize } = spawnObject(data, header)

      return {
        dnaManager: dnaManager as DnaManager<T>,
        processedBytes: processedBytes + dnaByteSize,
      }
    } else if (isHeaderType(header!, Type.nullableArray)) {
      const { dnaManager, dnaByteSize } = spawnNullableArray(data, header)

      return {
        dnaManager: dnaManager as DnaManager<T>,
        processedBytes: processedBytes + dnaByteSize,
      }
    } else if (isHeaderType(header!, Type.nullableObject)) {
      const { dnaManager, dnaByteSize } = spawnNullableObject(data, header)

      return {
        dnaManager: dnaManager as DnaManager<T>,
        processedBytes: processedBytes + dnaByteSize,
      }
    }

    return {
      dnaManager: new DnaManager(
        header.obfuscationKey,
        header.version,
        header.type,
        null as TypeDefinitions<T>,
      ),
      processedBytes,
    }
  }

  private static spawnHeader(bytes: Bytes<64>): Header<Type> {
    const obfuscationKey = bytes.slice(0, 32) as Bytes<32>
    const decryptedBytes = new Uint8Array(bytes.slice(32))
    encryptDecrypt(obfuscationKey, decryptedBytes)
    const versionBytes = decryptedBytes.slice(0, 4) as Bytes<4>
    const version = deserializeVersion(versionBytes)
    const type = deserializeType(decryptedBytes.slice(30) as Bytes<2>)

    // version check
    if (!equalBytes(versionBytes, serializeVersion(Version.unpackedV0_1))) {
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

  public static loadDnaRootObject<T extends Type>(dna: DnaRootObject<T>): DnaManager<T> {
    return DnaManager.loadDnaObject(dna, dna.obfuscationKey, dna.version)
  }

  public static loadDnaObject<T extends Type>(
    dna: DnaObject<T>,
    obfuscationKey: Bytes<32> = new Bytes(32),
    version = Version.unpackedV0_1,
    nullable = false,
  ): DnaManager<T> {
    assertObfuscationKey(obfuscationKey)
    assertVersion(version)

    if (isDnaObjectType(dna, Type.array)) {
      const typeDefinitions: TypeDefinitionA[] = dna.children.map(child => {
        return {
          segmentLength: child.segmentLength,
          beeSon: new BeeSon({
            dnaManager: DnaManager.loadDnaObject(child.dna, obfuscationKey, version) as DnaManager<any>,
            obfuscationKey,
          }),
        }
      })

      return new DnaManager(obfuscationKey, version, Type.array, typeDefinitions, nullable) as DnaManager<T>
    } else if (isDnaObjectType(dna, Type.nullableArray)) {
      const typeDefinitions: TypeDefinitionA[] = dna.children.map(child => {
        return {
          segmentLength: child.segmentLength,
          beeSon: new BeeSon({
            dnaManager: DnaManager.loadDnaObject(
              child.dna,
              obfuscationKey,
              version,
              child.nullable,
            ) as DnaManager<any>,
            obfuscationKey,
          }),
        }
      })

      return new DnaManager(
        obfuscationKey,
        version,
        Type.nullableArray,
        typeDefinitions,
        nullable,
      ) as DnaManager<T>
    } else if (isDnaObjectType(dna, Type.object)) {
      const typeDefinitions: TypeDefinitionO[] = dna.children.map(child => {
        return {
          segmentLength: child.segmentLength,
          beeSon: new BeeSon({
            dnaManager: DnaManager.loadDnaObject(child.dna, obfuscationKey, version) as DnaManager<any>,
            obfuscationKey,
          }),
          marker: child.marker,
        }
      })

      return new DnaManager(obfuscationKey, version, Type.object, typeDefinitions, nullable) as DnaManager<T>
    } else if (isDnaObjectType(dna, Type.nullableObject)) {
      const typeDefinitions: TypeDefinitionO[] = dna.children.map(child => {
        return {
          segmentLength: child.segmentLength,
          beeSon: new BeeSon({
            dnaManager: DnaManager.loadDnaObject(
              child.dna,
              obfuscationKey,
              version,
              child.nullable,
            ) as DnaManager<any>,
            obfuscationKey,
          }),
          marker: child.marker,
        }
      })

      return new DnaManager(
        obfuscationKey,
        version,
        Type.nullableObject,
        typeDefinitions,
        nullable,
      ) as DnaManager<T>
    }

    return new DnaManager(obfuscationKey, version, dna.type, null as TypeDefinitions<T>, nullable)
  }

  // mutate methods

  /**
   * Set container object element nullable or disallow to be that
   * @throws if the stored json value of the element has conflict with the nullable dna parameter
   * | (e.g.) DNA was nullable before and the json value null, and user changes nullable to false
   */
  public setTypeDefinitionNullable(typeDefIndex: number, nullable: boolean) {
    if (!this._typeDefinitions) throw new Error(`DNA does not handle a container type`)
    if (!isDnaManagerType(this, Type.nullableArray) && !isDnaManagerType(this, Type.nullableObject)) {
      throw new Error(`DNA does not handle nullable container here`)
    }
    if (!this.typeDefinitions[typeDefIndex]) {
      throw new Error(`there is no typedefintion on index ${typeDefIndex}`)
    }
    const oldBeeSon = this.typeDefinitions[typeDefIndex].beeSon
    const oldDnaManager = oldBeeSon.dnaManager
    const oldTypeDefs = Array.isArray(oldDnaManager.typeDefinitions)
      ? [...oldDnaManager.typeDefinitions]
      : oldDnaManager.typeDefinitions
    const newDnaManager = new DnaManager(
      oldDnaManager.obfuscationKey,
      oldDnaManager.version,
      oldDnaManager.type,
      oldTypeDefs,
      nullable,
    )
    const newBeeSon = new BeeSon({ dnaManager: newDnaManager })
    newBeeSon.json = oldBeeSon.json
    //overwrite new beeson object for element
    this.typeDefinitions[typeDefIndex].beeSon = newBeeSon
  }

  public getNullableContainerDnaManager(): NullableContainerDnaManager<T> {
    if (isDnaManagerType(this, Type.array)) {
      const typeDefinitions = this._typeDefinitions.map(oldTypeDef => {
        const oldBeeSon = oldTypeDef.beeSon
        const oldDnaManager = oldBeeSon.dnaManager
        const newDnaManager = new DnaManager(
          oldDnaManager.obfuscationKey,
          oldDnaManager.version,
          oldDnaManager.type,
          oldDnaManager.typeDefinitions,
          true,
        )
        const newBeeSon = new BeeSon({ dnaManager: newDnaManager })
        const newTypeDef: TypeDefinitionA = {
          segmentLength: oldTypeDef.segmentLength,
          beeSon: newBeeSon,
        }

        return newTypeDef
      })

      return new DnaManager(
        this.obfuscationKey,
        this.version,
        Type.nullableArray,
        typeDefinitions,
      ) as NullableContainerDnaManager<T>
    }
    if (isDnaManagerType(this, Type.object)) {
      const typeDefinitions = this._typeDefinitions.map(oldTypeDef => {
        const oldBeeSon = oldTypeDef.beeSon
        const oldDnaManager = oldBeeSon.dnaManager
        const newDnaManager = new DnaManager(
          oldDnaManager.obfuscationKey,
          oldDnaManager.version,
          oldDnaManager.type,
          oldDnaManager.typeDefinitions,
          true,
        )
        const newBeeSon = new BeeSon({ dnaManager: newDnaManager })
        const newTypeDef: TypeDefinitionO = {
          ...oldTypeDef,
          beeSon: newBeeSon,
        }

        return newTypeDef
      })

      return new DnaManager(
        this.obfuscationKey,
        this.version,
        Type.nullableObject,
        typeDefinitions,
      ) as NullableContainerDnaManager<T>
    }

    throw new Error(`This DNA does not represent a nullable container value`)
  }
}

export function generateDna<T extends JsonValue>(
  json: T,
  obfuscationKey?: Bytes<32>,
): DnaManager<ValueType<T>> {
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

    return new DnaManager(obfuscationKey, version, type, typeDefinitions as TypeDefinitions<ValueType<T>>)
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

    return new DnaManager(obfuscationKey, version, type, typeDefinitions as TypeDefinitions<ValueType<T>>)
  }

  return new DnaManager(obfuscationKey, version, type, null as TypeDefinitions<ValueType<T>>)
}

export function isDnaManagerType<T extends Type>(
  dnaManager: DnaManager<Type>,
  type: T,
): dnaManager is DnaManager<T> {
  return dnaManager.type === type
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

function serializeVersion(version: Version): Bytes<4> {
  return new Bytes([1, ...serializeVersionSemver(version)])
}

function deserializeVersion(bytes: Bytes<4>): Version {
  if (bytes[0] !== BEESON_HEADER_ID) {
    throw new Error(`Error at version deserialization: ${bytes[0]} is not a BeeSon type in the header`)
  }

  const version = deserializeVersionSemver(bytes.slice(1) as Bytes<3>)

  if (version !== Version.unpackedV0_1) {
    throw new Error(`Error at version deserialization: ${version} is not an existing BeeSon version`)
  }

  return version
}

function serializeVersionSemver(version: Version): Bytes<3> {
  const versionArray = version.split('.').map(v => Number(v))

  return new Bytes([versionArray[0], versionArray[1], versionArray[2]])
}

function deserializeVersionSemver(bytes: Bytes<3>): Version {
  const strings: string[] = []
  for (const byte of bytes) {
    strings.push(byte.toString())
  }

  return strings.join('.') as Version
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
