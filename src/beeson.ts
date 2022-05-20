/* eslint-disable complexity */
import { AbiManager, generateAbi, Header, isAbiManagerType, TypeDefinitionO } from './abi'
import {
  deserializeSwarmCac,
  deserializeSwarmSoc,
  serializeSwarmCac,
  serializeSwarmSoc,
  SwarmFeedCid,
  SwarmManifestCid,
} from './address-serializer'
import { deserializeBoolean, serializeBoolean } from './boolean-serializer'
import { deserializeFloat, deserializeInt, serializeFloat, serliazeInt } from './number-serializer'
import { deserializeString, serializeString } from './string-seralizer'
import {
  isContainerType,
  JsonMap,
  JsonValue,
  NotSupportedTypeError,
  Nullable,
  Type,
  TypeValue,
  ValueType,
} from './types'
import {
  assertJsonValue,
  Bytes,
  encryptDecrypt,
  flattenBytesArray,
  segmentPaddingFromLeft,
  segmentPaddingFromRight,
  SEGMENT_SIZE,
} from './utils'

function isBeeSonType<T extends Type>(beeSon: unknown, type: T): beeSon is BeeSon<TypeValue<T>> {
  return (beeSon as BeeSon<JsonValue>).abiManager.type === type
}

interface JsonParams<T extends JsonValue> {
  json: T
  obfuscationKey?: Bytes<32>
}

interface AbiParams<T extends JsonValue = JsonValue> {
  abiManager: AbiManager<ValueType<T>>
}

function isAbiParams<T extends JsonValue>(params: unknown): params is AbiParams<T> {
  return typeof params === 'object' && Object.keys(params as object).includes('abiManager')
}

function isJsonParams<T extends JsonValue>(params: unknown): params is JsonParams<T> {
  return typeof params === 'object' && Object.keys(params as object).includes('json')
}

class JsonValueUndefinedError extends Error {
  constructor() {
    super('There is no JSON value set')
  }
}

type NullableContainerBeeSon<T extends JsonValue> = T extends JsonMap<unknown>
  ? BeeSon<Nullable<T>>
  : T extends Type.object
  ? BeeSon<Nullable<T>>
  : never

export class BeeSon<T extends JsonValue> {
  private _abiManager: AbiManager<ValueType<T>>
  private _json: T | undefined

  constructor(params: JsonParams<T> | AbiParams<T>) {
    if (isAbiParams(params)) {
      this._abiManager = params.abiManager
    } else if (isJsonParams(params)) {
      this._json = params.json
      this._abiManager = generateAbi(this._json)
    } else throw new Error(`Invalid BeeSon constructor parameters`)
  }

  // Setters/getters

  /** ABI manager instance of the BeeSon value */
  public get abiManager(): AbiManager<ValueType<T>> {
    return this._abiManager
  }

  public get json(): T {
    if (this._json === undefined) {
      throw new JsonValueUndefinedError()
    }

    if (isBeeSonType(this, Type.array)) return [...this._json] as T
    else if (isBeeSonType(this, Type.object)) return { ...(this._json as object) } as T

    return this._json
  }

  /**
   * Set BeeSon value according to its corresponding ABI
   */
  public set json(value: T) {
    this._abiManager.assertJsonValue(value)

    if (
      isAbiManagerType(this._abiManager, Type.array) ||
      isAbiManagerType(this._abiManager, Type.nullableArray)
    ) {
      for (const [index, typeDefition] of this._abiManager.typeDefinitions.entries()) {
        try {
          const arrayItem = (value as Array<unknown>)[index]
          typeDefition.beeSon.json = arrayItem as JsonValue
        } catch (e) {
          throw new Error(`BeeSon Array assertion problem at index ${index}: ${(e as Error).message}`)
        }
      }
    } else if (
      isAbiManagerType(this._abiManager, Type.object) ||
      isAbiManagerType(this._abiManager, Type.nullableObject)
    ) {
      for (const typeDefinition of this._abiManager.typeDefinitions) {
        const def = typeDefinition as TypeDefinitionO // TODO create bug report in typescript
        const marker = def.marker
        try {
          const arrayItem = (value as Record<string, unknown>)[marker]
          def.beeSon.json = arrayItem as JsonValue
        } catch (e) {
          throw new Error(`BeeSon Object assertion problem at index ${marker}: ${(e as Error).message}`)
        }
      }
    }

    this._json = value
  }

  public serialize(options?: { withoutBlobHeader?: boolean }): Uint8Array {
    const withoutBlobHeader = options?.withoutBlobHeader || false
    const abiBytes = this.serializeAbi(withoutBlobHeader)

    if (isAbiManagerType(this._abiManager, Type.array) || isAbiManagerType(this._abiManager, Type.object)) {
      const containerBytes: Uint8Array[] = [abiBytes]
      for (const typeDefition of this._abiManager.typeDefinitions) {
        containerBytes.push(typeDefition.beeSon.serialize({ withoutBlobHeader: true }))
      }

      return flattenBytesArray(containerBytes)
    }

    return new Uint8Array([...abiBytes, ...this.serializeData()])
  }

  /** deserialise unpacked data */
  public static deserialize(data: Uint8Array, header?: Header<Type>): BeeSon<JsonValue> {
    const { abiManager, processedBytes } = AbiManager.deserialize(data, header)
    const beeSon = new BeeSon({ abiManager })
    beeSon.deserializeData(data.slice(processedBytes))

    return beeSon
  }

  private serializeAbi(withoutBlobHeader: boolean): Uint8Array {
    return this._abiManager.serialize(withoutBlobHeader)
  }

  public deserializeData(data: Uint8Array): void {
    const decryptedData = new Uint8Array([...data])
    encryptDecrypt(this._abiManager.obfuscationKey, decryptedData)
    // numbers
    if (isAbiManagerType(this._abiManager, Type.float32)) {
      this.json = deserializeFloat(
        this._abiManager.type as Type.float32,
        decryptedData.slice(SEGMENT_SIZE - 4) as Bytes<4>,
      ) as T
    } else if (isAbiManagerType(this._abiManager, Type.float64)) {
      this.json = deserializeFloat(
        this._abiManager.type as Type.float64,
        decryptedData.slice(SEGMENT_SIZE - 8) as Bytes<8>,
      ) as T
    } else if (
      isAbiManagerType(this._abiManager, Type.int8) ||
      isAbiManagerType(this._abiManager, Type.uint8)
    ) {
      this.json = deserializeInt(this._abiManager.type, decryptedData.slice(SEGMENT_SIZE - 1)) as T
    } else if (isAbiManagerType(this._abiManager, Type.int16)) {
      this.json = deserializeInt(this._abiManager.type, decryptedData.slice(SEGMENT_SIZE - 2)) as T
    } else if (isAbiManagerType(this._abiManager, Type.int32)) {
      this.json = deserializeInt(this._abiManager.type, decryptedData.slice(SEGMENT_SIZE - 4)) as T
    } else if (isAbiManagerType(this._abiManager, Type.int64)) {
      this.json = deserializeInt(this._abiManager.type, decryptedData.slice(SEGMENT_SIZE - 8)) as T
    }
    // string
    else if (isAbiManagerType(this._abiManager, Type.string)) {
      this.json = deserializeString(decryptedData) as T
    }
    // boolean
    else if (isAbiManagerType(this._abiManager, Type.boolean)) {
      this.json = deserializeBoolean(decryptedData.slice(SEGMENT_SIZE - 1) as Bytes<1>) as T
    }
    // misc types
    else if (isAbiManagerType(this._abiManager, Type.swarmCac)) {
      this.json = deserializeSwarmCac(decryptedData) as T
    } else if (isAbiManagerType(this._abiManager, Type.swarmSoc)) {
      this.json = deserializeSwarmSoc(decryptedData) as T
    }
    // container types
    else if (isAbiManagerType(this._abiManager, Type.object)) {
      const obj: Record<string, unknown> = {}
      let segmentOffset = 0
      for (const typeDefinition of this._abiManager.typeDefinitions) {
        const typeDef = typeDefinition as TypeDefinitionO
        const key = typeDef.marker
        const offset = segmentOffset * SEGMENT_SIZE
        const endOffset = typeDef.segmentLength ? offset + typeDef.segmentLength * SEGMENT_SIZE : undefined
        if (isContainerType(typeDef.beeSon.abiManager.type)) {
          typeDef.beeSon = BeeSon.deserialize(decryptedData.slice(offset, endOffset), {
            // abimanager type/obfuscationkey and else is set already on abi deserialisation
            obfuscationKey: typeDef.beeSon.abiManager.obfuscationKey,
            type: typeDef.beeSon.abiManager.type,
            version: typeDef.beeSon.abiManager.version,
          })
          obj[key] = typeDef.beeSon.json
        } else {
          typeDef.beeSon.deserializeData(decryptedData.slice(offset, endOffset))
          obj[key] = typeDef.beeSon.json
        }
        segmentOffset += typeDef.segmentLength || 0
      }
      this.json = obj as T
    } else if (isAbiManagerType(this._abiManager, Type.array)) {
      const arr: unknown[] = []
      let segmentOffset = 0
      for (const typeDefinition of this._abiManager.typeDefinitions) {
        const typeDef = typeDefinition
        const offset = segmentOffset * SEGMENT_SIZE
        const endOffset = typeDef.segmentLength ? offset + typeDef.segmentLength * SEGMENT_SIZE : undefined
        if (isContainerType(typeDef.beeSon.abiManager.type)) {
          typeDef.beeSon = BeeSon.deserialize(decryptedData.slice(offset, endOffset), {
            // abimanager type/obfuscationkey and else is set already on abi deserialisation
            obfuscationKey: typeDef.beeSon.abiManager.obfuscationKey,
            type: typeDef.beeSon.abiManager.type,
            version: typeDef.beeSon.abiManager.version,
          })
          arr.push(typeDef.beeSon.json)
        } else {
          typeDef.beeSon.deserializeData(decryptedData.slice(offset, endOffset))
          arr.push(typeDef.beeSon.json)
        }
        segmentOffset += typeDef.segmentLength || 0
      }
      this.json = arr as T
    }
  }

  /** Gives back data implementation's serialisation in 32 bytes segments */
  private serializeData(): Uint8Array {
    if (this._json === undefined) {
      throw new JsonValueUndefinedError()
    }
    // numbers
    if (isBeeSonType(this, Type.float32)) {
      const bytes = segmentPaddingFromLeft(serializeFloat(this._json, Type.float32))
      encryptDecrypt(this._abiManager.obfuscationKey, bytes)

      return bytes
    }
    if (isBeeSonType(this, Type.float64)) {
      const bytes = segmentPaddingFromLeft(serializeFloat(this._json, Type.float64))
      encryptDecrypt(this._abiManager.obfuscationKey, bytes)

      return bytes
    }
    if (isBeeSonType(this, Type.int8)) {
      const bytes = segmentPaddingFromLeft(serliazeInt(this._json, Type.int8))
      encryptDecrypt(this._abiManager.obfuscationKey, bytes)

      return bytes
    }
    if (isBeeSonType(this, Type.uint8)) {
      const bytes = segmentPaddingFromLeft(serliazeInt(this._json, Type.uint8))
      encryptDecrypt(this._abiManager.obfuscationKey, bytes)

      return bytes
    }
    if (isBeeSonType(this, Type.int16)) {
      const bytes = segmentPaddingFromLeft(serliazeInt(this._json, Type.int16))
      encryptDecrypt(this._abiManager.obfuscationKey, bytes)

      return bytes
    }
    if (isBeeSonType(this, Type.int32)) {
      const bytes = segmentPaddingFromLeft(serliazeInt(this._json, Type.int32))
      encryptDecrypt(this._abiManager.obfuscationKey, bytes)

      return bytes
    }
    if (isBeeSonType(this, Type.int64)) {
      const bytes = segmentPaddingFromLeft(serliazeInt(this._json, Type.int64))
      encryptDecrypt(this._abiManager.obfuscationKey, bytes)

      return bytes
    }
    // string
    if (isBeeSonType(this, Type.string)) {
      const bytes = segmentPaddingFromRight(serializeString(this._json))
      encryptDecrypt(this._abiManager.obfuscationKey, bytes)

      return bytes
    }
    // boolean
    if (isBeeSonType(this, Type.boolean)) {
      const bytes = segmentPaddingFromRight(serializeBoolean(this._json))
      encryptDecrypt(this._abiManager.obfuscationKey, bytes)

      return bytes
    }
    // misc types
    if (isBeeSonType(this, Type.swarmCac)) {
      const bytes = serializeSwarmCac(this._json as SwarmManifestCid)
      encryptDecrypt(this._abiManager.obfuscationKey, bytes)

      return bytes
    }
    if (isBeeSonType(this, Type.swarmSoc)) {
      const bytes = serializeSwarmSoc(this.json as SwarmFeedCid)
      encryptDecrypt(this._abiManager.obfuscationKey, bytes)

      return bytes
    }
    // container types
    if (isAbiManagerType(this._abiManager, Type.object) || isAbiManagerType(this._abiManager, Type.array)) {
      const objectValuesBytes: Uint8Array[] = []
      for (const typeDefinition of this._abiManager.typeDefinitions) {
        objectValuesBytes.push(typeDefinition.beeSon.serialize({ withoutBlobHeader: true }))
      }

      // objectValuesBytes already 32 bytes padded
      const bytes = flattenBytesArray(objectValuesBytes)
      encryptDecrypt(this._abiManager.obfuscationKey, bytes)

      return bytes
    }

    throw new NotSupportedTypeError(this.abiManager.type)
  }

  public setIndexNullable(index: keyof T, nullable: boolean) {
    if (isAbiManagerType(this._abiManager, Type.nullableObject)) {
      for (const [typeDefIndex, typeDefinition] of this._abiManager.typeDefinitions.entries()) {
        const typeDef = typeDefinition as TypeDefinitionO
        if (typeDef.marker === index) {
          return this._abiManager.setTypeDefinitionNullable(typeDefIndex, nullable)
        }
      }

      throw new Error(`Index "${index} has been not found"`)
    } else if (isAbiManagerType(this._abiManager, Type.nullableArray)) {
      return this._abiManager.setTypeDefinitionNullable(index as number, nullable)
    }
    throw new Error(`BeeSon object is not a nullable container type. It has type: ${this._abiManager.type}`)
  }

  private tryToSetArray(value: Array<unknown>) {
    if (isAbiManagerType(this._abiManager, Type.array)) {
      for (const [index, typeDefition] of this._abiManager.typeDefinitions.entries()) {
        try {
          const arrayItem = value[index]
          assertJsonValue(arrayItem)
          typeDefition.beeSon.json = arrayItem
        } catch (e) {
          throw new Error(`BeeSon Array assertion problem at index ${index}: ${(e as Error).message}`)
        }
      }
    } else if (isAbiManagerType(this._abiManager, Type.nullableArray)) {
      for (const [index, typeDefition] of this._abiManager.typeDefinitions.entries()) {
        try {
          const arrayItem = value[index]

          typeDefition.beeSon.json = arrayItem as JsonValue
        } catch (e) {
          throw new Error(`BeeSon Array assertion problem at index ${index}: ${(e as Error).message}`)
        }
      }
    }
  }

  public getNullableContainer(): NullableContainerBeeSon<T> {
    const abiManager = this._abiManager.getNullableContainerAbiManager()
    const newBeeSon = new BeeSon({ abiManager })
    newBeeSon.json = this.json

    return newBeeSon as NullableContainerBeeSon<T>
  }
}
