/* eslint-disable complexity */
import { AbiManager, generateAbi, Header, isAbiManagerType, TypeDefitionO } from './abi'
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
import { isContainerType, JsonValue, NotSupportedTypeError, Type, TypeValue, ValueType } from './types'
import {
  assertJsonValue,
  Bytes,
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

    if (isAbiManagerType(this._abiManager, Type.array)) {
      for (const [index, typeDefition] of this._abiManager.typeDefinitions.entries()) {
        try {
          const arrayItem = (value as Array<unknown>)[index]
          assertJsonValue(arrayItem)
          typeDefition.beeSon.json = arrayItem
        } catch (e) {
          throw new Error(`BeeSon Array assertion problem at index ${index}: ${(e as Error).message}`)
        }
      }
    } else if (isAbiManagerType(this._abiManager, Type.object)) {
      for (const typeDefinition of this._abiManager.typeDefinitions) {
        const def = typeDefinition as TypeDefitionO // TODO create bug report in typescript
        const marker = def.marker
        try {
          const arrayItem = (value as Record<string, unknown>)[marker]
          assertJsonValue(arrayItem)
          def.beeSon.json = arrayItem
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
    // numbers
    if (isAbiManagerType(this._abiManager, Type.float32)) {
      this.json = deserializeFloat(
        this._abiManager.type as Type.float32,
        data.slice(SEGMENT_SIZE - 4) as Bytes<4>,
      ) as T
    } else if (isAbiManagerType(this._abiManager, Type.float64)) {
      this.json = deserializeFloat(
        this._abiManager.type as Type.float64,
        data.slice(SEGMENT_SIZE - 8) as Bytes<8>,
      ) as T
    } else if (
      isAbiManagerType(this._abiManager, Type.int8) ||
      isAbiManagerType(this._abiManager, Type.uint8)
    ) {
      this.json = deserializeInt(this._abiManager.type, data.slice(SEGMENT_SIZE - 1)) as T
    } else if (isAbiManagerType(this._abiManager, Type.int16)) {
      this.json = deserializeInt(this._abiManager.type, data.slice(SEGMENT_SIZE - 2)) as T
    } else if (isAbiManagerType(this._abiManager, Type.int32)) {
      this.json = deserializeInt(this._abiManager.type, data.slice(SEGMENT_SIZE - 4)) as T
    } else if (isAbiManagerType(this._abiManager, Type.int64)) {
      this.json = deserializeInt(this._abiManager.type, data.slice(SEGMENT_SIZE - 8)) as T
    }
    // string
    else if (isAbiManagerType(this._abiManager, Type.string)) {
      this.json = deserializeString(data) as T
    }
    // boolean
    else if (isAbiManagerType(this._abiManager, Type.boolean)) {
      this.json = deserializeBoolean(data.slice(SEGMENT_SIZE - 1) as Bytes<1>) as T
    }
    // misc types
    else if (isAbiManagerType(this._abiManager, Type.swarmCac)) {
      this.json = deserializeSwarmCac(data) as T
    } else if (isAbiManagerType(this._abiManager, Type.swarmSoc)) {
      this.json = deserializeSwarmSoc(data) as T
    }
    // container types
    else if (isAbiManagerType(this._abiManager, Type.object)) {
      const obj: Record<string, unknown> = {}
      let segmentOffset = 0
      for (const typeDefinition of this._abiManager.typeDefinitions) {
        const typeDef = typeDefinition as TypeDefitionO
        const key = typeDef.marker
        const offset = segmentOffset * SEGMENT_SIZE
        const endOffset = typeDef.segmentLength ? offset + typeDef.segmentLength * SEGMENT_SIZE : undefined
        if (isContainerType(typeDef.beeSon.abiManager.type)) {
          typeDef.beeSon = BeeSon.deserialize(data.slice(offset, endOffset), {
            // abimanager type/obfuscationkey and else is set already on abi deserialisation
            obfuscationKey: typeDef.beeSon.abiManager.obfuscationKey,
            type: typeDef.beeSon.abiManager.type,
            version: typeDef.beeSon.abiManager.version,
          })
          obj[key] = typeDef.beeSon.json
        } else {
          typeDef.beeSon.deserializeData(data.slice(offset, endOffset))
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
          typeDef.beeSon = BeeSon.deserialize(data.slice(offset, endOffset), {
            // abimanager type/obfuscationkey and else is set already on abi deserialisation
            obfuscationKey: typeDef.beeSon.abiManager.obfuscationKey,
            type: typeDef.beeSon.abiManager.type,
            version: typeDef.beeSon.abiManager.version,
          })
          arr.push(typeDef.beeSon.json)
        } else {
          typeDef.beeSon.deserializeData(data.slice(offset, endOffset))
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
      return segmentPaddingFromLeft(serializeFloat(this._json, Type.float32))
    }
    if (isBeeSonType(this, Type.float64)) {
      return segmentPaddingFromLeft(serializeFloat(this._json, Type.float64))
    }
    if (isBeeSonType(this, Type.int8)) {
      return segmentPaddingFromLeft(serliazeInt(this._json, Type.int8))
    }
    if (isBeeSonType(this, Type.uint8)) {
      return segmentPaddingFromLeft(serliazeInt(this._json, Type.uint8))
    }
    if (isBeeSonType(this, Type.int16)) {
      return segmentPaddingFromLeft(serliazeInt(this._json, Type.int16))
    }
    if (isBeeSonType(this, Type.int32)) {
      return segmentPaddingFromLeft(serliazeInt(this._json, Type.int32))
    }
    if (isBeeSonType(this, Type.int64)) {
      return segmentPaddingFromLeft(serliazeInt(this._json, Type.int64))
    }
    // string
    if (isBeeSonType(this, Type.string)) {
      return segmentPaddingFromRight(serializeString(this._json))
    }
    // boolean
    if (isBeeSonType(this, Type.boolean)) {
      return segmentPaddingFromRight(serializeBoolean(this._json))
    }
    // misc types
    if (isBeeSonType(this, Type.swarmCac)) {
      return serializeSwarmCac(this._json as SwarmManifestCid)
    }
    if (isBeeSonType(this, Type.swarmSoc)) {
      return serializeSwarmSoc(this.json as SwarmFeedCid)
    }
    // container types
    if (isAbiManagerType(this._abiManager, Type.object) || isAbiManagerType(this._abiManager, Type.array)) {
      const objectValuesBytes: Uint8Array[] = []
      for (const typeDefinition of this._abiManager.typeDefinitions) {
        objectValuesBytes.push(typeDefinition.beeSon.serialize({ withoutBlobHeader: true }))
      }

      // objectValuesBytes already 32 bytes padded
      return flattenBytesArray(objectValuesBytes)
    }

    throw new NotSupportedTypeError(this.abiManager.type)
  }
}
