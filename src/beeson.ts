import { AbiManager, generateAbi, Header, isAbiManagerType, TypeDefinitionO } from './abi'
import {
  deserializeSwarmCac,
  deserializeSwarmSoc,
  serializeSwarmCac,
  serializeSwarmSoc,
  SwarmFeedCid,
  SwarmManifestCid,
} from './marshalling/address-serializer'
import { BitVector } from './bitvector'
import { deserializeBoolean, serializeBoolean } from './marshalling/boolean-serializer'
import {
  deserializeFloat,
  deserializeInt,
  serializeFloat,
  serliazeInt,
} from './marshalling/number-serializer'
import { deserializeString, serializeString } from './marshalling/string-seralizer'
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
  Bytes,
  encryptDecrypt,
  flattenBytesArray,
  isNull,
  segmentPaddingFromLeft,
  segmentPaddingFromRight,
  segmentSize,
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

    if (isBeeSonType(this, Type.array) && this._json !== null) return [...this._json] as T
    else if (isBeeSonType(this, Type.object) && this._json !== null) return { ...(this._json as object) } as T

    return this._json
  }

  /**
   * Set BeeSon value according to its corresponding ABI
   */
  public set json(value: T) {
    this._abiManager.assertJsonValue(value)

    if (this._abiManager.nullable && isNull(value)) {
      this._json = value

      return
    }
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

    if (
      isAbiManagerType(this._abiManager, Type.array) ||
      isAbiManagerType(this._abiManager, Type.object) ||
      isAbiManagerType(this._abiManager, Type.nullableArray) ||
      isAbiManagerType(this._abiManager, Type.nullableObject)
    ) {
      const containerBytes: Uint8Array[] = [abiBytes]
      if (
        isAbiManagerType(this._abiManager, Type.nullableArray) ||
        isAbiManagerType(this._abiManager, Type.nullableObject)
      ) {
        containerBytes.push(this.serializeContainerElementsNulls())
        for (const typeDefition of this._abiManager.typeDefinitions) {
          if (!(typeDefition.beeSon._abiManager.nullable && typeDefition.beeSon.json === null)) {
            containerBytes.push(typeDefition.beeSon.serialize({ withoutBlobHeader: true }))
          }
        }
      } else {
        for (const typeDefition of this._abiManager.typeDefinitions) {
          containerBytes.push(typeDefition.beeSon.serialize({ withoutBlobHeader: true }))
        }
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
      this.deserializeObject(decryptedData)
    } else if (isAbiManagerType(this._abiManager, Type.array)) {
      this.deserializeArray(decryptedData)
    } else if (isAbiManagerType(this._abiManager, Type.nullableArray)) {
      this.deserializeNullableArray(decryptedData)
    } else if (isAbiManagerType(this._abiManager, Type.nullableObject)) {
      this.deserializeNullableObject(decryptedData)
    }
  }

  /** Gives back data implementation's serialisation in 32 bytes segments */
  private serializeData(): Uint8Array {
    if (this._json === undefined) {
      throw new JsonValueUndefinedError()
    }
    if (this._json === null) {
      return new Uint8Array(0)
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
      return this.serializeContainerElementsData()
    }
    if (
      isAbiManagerType(this._abiManager, Type.nullableObject) ||
      isAbiManagerType(this._abiManager, Type.nullableArray)
    ) {
      return new Uint8Array([
        ...this.serializeContainerElementsNulls(),
        ...this.serializeContainerElementsData(),
      ])
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

  private serializeContainerElementsData(): Uint8Array {
    if (
      !isAbiManagerType(this._abiManager, Type.object) &&
      !isAbiManagerType(this._abiManager, Type.array) &&
      !isAbiManagerType(this._abiManager, Type.nullableArray) &&
      !isAbiManagerType(this._abiManager, Type.nullableObject)
    ) {
      throw new Error(`BeeSon is not a (nullable) container type. it has type: ${this.abiManager.type}`)
    }
    const objectValuesBytes: Uint8Array[] = []
    for (const typeDefinition of this._abiManager.typeDefinitions) {
      objectValuesBytes.push(typeDefinition.beeSon.serialize({ withoutBlobHeader: true }))
    }

    // objectValuesBytes already 32 bytes padded
    const bytes = flattenBytesArray(objectValuesBytes)
    encryptDecrypt(this._abiManager.obfuscationKey, bytes)

    return bytes
  }

  /** Serialize Null bitvector for nullable containers in the data implementation */
  private serializeContainerElementsNulls(): Uint8Array {
    if (
      !isAbiManagerType(this._abiManager, Type.nullableArray) &&
      !isAbiManagerType(this._abiManager, Type.nullableObject)
    ) {
      throw new Error(`BeeSon is not a nullable container type. it has type: ${this.abiManager.type}`)
    }

    // const
    const bv = new BitVector(this._abiManager.typeDefinitions.length)
    if (isAbiManagerType(this._abiManager, Type.nullableObject)) {
      for (const [index, typeDefinition] of this._abiManager.typeDefinitions.entries()) {
        const typeDef = typeDefinition as TypeDefinitionO
        if ((this._json as Record<string, unknown>)[typeDef.marker] === null) {
          bv.setBit(index)
        }
      }
    } else {
      // it is nullableArray
      for (const [index] of this._abiManager.typeDefinitions.entries()) {
        if ((this._json as unknown[])[index] === null) {
          bv.setBit(index)
        }
      }
    }

    const vektorSegments = segmentPaddingFromRight(bv.bitVector)
    encryptDecrypt(this._abiManager.obfuscationKey, vektorSegments)

    return vektorSegments
  }

  /** Deserialize Null bitvector for nullable containers in the data implementation */
  private deserializeContainerElementsNulls(bitVectorSegments: Uint8Array): BitVector {
    if (
      !isAbiManagerType(this._abiManager, Type.nullableArray) &&
      !isAbiManagerType(this._abiManager, Type.nullableObject)
    ) {
      throw new Error(`BeeSon is not a nullable container type. it has type: ${this.abiManager.type}`)
    }

    const bitVectorBytes = bitVectorSegments.slice(0, Math.ceil(this._abiManager.typeDefinitions.length / 8))

    return new BitVector(this._abiManager.typeDefinitions.length, bitVectorBytes)
  }

  private deserializeObject(data: Uint8Array) {
    if (!isAbiManagerType(this._abiManager, Type.object)) throw new Error(`ABI type is not a ${Type.object}`)
    const obj: Record<string, unknown> = {}
    let segmentOffset = 0
    for (const typeDefinition of this._abiManager.typeDefinitions) {
      const typeDef = typeDefinition as TypeDefinitionO
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
  }

  private deserializeNullableObject(data: Uint8Array) {
    if (!isAbiManagerType(this._abiManager, Type.nullableObject)) {
      throw new Error(`ABI type is not a ${Type.object}`)
    }
    const obj: Record<string, unknown> = {}
    let segmentOffset = segmentSize(Math.ceil(this._abiManager.typeDefinitions.length / 8))
    const bitVector = this.deserializeContainerElementsNulls(data.slice(0, segmentOffset * SEGMENT_SIZE))
    for (const [i, typeDefinition] of this._abiManager.typeDefinitions.entries()) {
      const typeDef = typeDefinition as TypeDefinitionO
      const key = typeDef.marker
      if (bitVector.getBit(i)) {
        typeDefinition.beeSon.json = null
        obj[key] = typeDefinition.beeSon.json

        continue
      }
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
  }

  private deserializeNullableArray(data: Uint8Array) {
    if (!isAbiManagerType(this._abiManager, Type.nullableArray)) {
      throw new Error(`ABI type is not a ${Type.object}`)
    }
    const arr: unknown[] = []
    let segmentOffset = segmentSize(Math.ceil(this._abiManager.typeDefinitions.length / 8))
    const bitVector = this.deserializeContainerElementsNulls(data.slice(0, segmentOffset * SEGMENT_SIZE))
    for (const [i, typeDefinition] of this._abiManager.typeDefinitions.entries()) {
      if (bitVector.getBit(i)) {
        typeDefinition.beeSon.json = null
        arr.push(typeDefinition.beeSon.json)

        continue
      }

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

  private deserializeArray(data: Uint8Array) {
    if (!isAbiManagerType(this._abiManager, Type.array)) {
      throw new Error(`ABI type is not a ${Type.object}`)
    }
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

  public getNullableContainer(): NullableContainerBeeSon<T> {
    const abiManager = this._abiManager.getNullableContainerAbiManager()
    const newBeeSon = new BeeSon({ abiManager })
    newBeeSon.json = this.json

    return newBeeSon as NullableContainerBeeSon<T>
  }
}
