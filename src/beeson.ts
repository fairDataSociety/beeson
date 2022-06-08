import { DnaManager, generateDna, Header, isDnaManagerType, TypeDefinitionO } from './dna'
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
  return (beeSon as BeeSon<JsonValue>).dnaManager.type === type
}

interface JsonParams<T extends JsonValue> {
  json: T
  obfuscationKey?: Bytes<32>
}

interface DnaParams<T extends JsonValue = JsonValue> {
  dnaManager: DnaManager<ValueType<T>>
}

function isDnaParams<T extends JsonValue>(params: unknown): params is DnaParams<T> {
  return typeof params === 'object' && Object.keys(params as object).includes('dnaManager')
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
  private _dnaManager: DnaManager<ValueType<T>>
  private _json: T | undefined

  constructor(params: JsonParams<T> | DnaParams<T>) {
    if (isDnaParams(params)) {
      this._dnaManager = params.dnaManager
    } else if (isJsonParams(params)) {
      this._json = params.json
      this._dnaManager = generateDna(this._json)
    } else throw new Error(`Invalid BeeSon constructor parameters`)
  }

  // Setters/getters

  /** DNA manager instance of the BeeSon value */
  public get dnaManager(): DnaManager<ValueType<T>> {
    return this._dnaManager
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
   * Set BeeSon value according to its corresponding DNA
   */
  public set json(value: T) {
    this._dnaManager.assertJsonValue(value)

    if (this._dnaManager.nullable && isNull(value)) {
      this._json = value

      return
    }
    if (
      isDnaManagerType(this._dnaManager, Type.array) ||
      isDnaManagerType(this._dnaManager, Type.nullableArray)
    ) {
      for (const [index, typeDefition] of this._dnaManager.typeDefinitions.entries()) {
        try {
          const arrayItem = (value as Array<unknown>)[index]
          typeDefition.beeSon.json = arrayItem as JsonValue
        } catch (e) {
          throw new Error(`BeeSon Array assertion problem at index ${index}: ${(e as Error).message}`)
        }
      }
    } else if (
      isDnaManagerType(this._dnaManager, Type.object) ||
      isDnaManagerType(this._dnaManager, Type.nullableObject)
    ) {
      for (const typeDefinition of this._dnaManager.typeDefinitions) {
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
    const dnaBytes = this.serializeDna(withoutBlobHeader)

    if (
      isDnaManagerType(this._dnaManager, Type.array) ||
      isDnaManagerType(this._dnaManager, Type.object) ||
      isDnaManagerType(this._dnaManager, Type.nullableArray) ||
      isDnaManagerType(this._dnaManager, Type.nullableObject)
    ) {
      const containerBytes: Uint8Array[] = [dnaBytes]
      if (
        isDnaManagerType(this._dnaManager, Type.nullableArray) ||
        isDnaManagerType(this._dnaManager, Type.nullableObject)
      ) {
        containerBytes.push(this.serializeContainerElementsNulls())
        for (const typeDefition of this._dnaManager.typeDefinitions) {
          if (!(typeDefition.beeSon._dnaManager.nullable && typeDefition.beeSon.json === null)) {
            containerBytes.push(typeDefition.beeSon.serialize({ withoutBlobHeader: true }))
          }
        }
      } else {
        for (const typeDefition of this._dnaManager.typeDefinitions) {
          containerBytes.push(typeDefition.beeSon.serialize({ withoutBlobHeader: true }))
        }
      }

      return flattenBytesArray(containerBytes)
    }

    return new Uint8Array([...dnaBytes, ...this.serializeData()])
  }

  /** deserialise unpacked data */
  public static deserialize(data: Uint8Array, header?: Header<Type>): BeeSon<JsonValue> {
    const { dnaManager, processedBytes } = DnaManager.spawn(data, header)
    const beeSon = new BeeSon({ dnaManager: dnaManager })
    beeSon.deserializeData(data.slice(processedBytes))

    return beeSon
  }

  private serializeDna(withoutBlobHeader: boolean): Uint8Array {
    return this._dnaManager.dna(withoutBlobHeader)
  }

  public deserializeData(data: Uint8Array): void {
    const decryptedData = new Uint8Array([...data])
    encryptDecrypt(this._dnaManager.obfuscationKey, decryptedData)
    // numbers
    if (isDnaManagerType(this._dnaManager, Type.float32)) {
      this.json = deserializeFloat(
        this._dnaManager.type as Type.float32,
        decryptedData.slice(SEGMENT_SIZE - 4) as Bytes<4>,
      ) as T
    } else if (isDnaManagerType(this._dnaManager, Type.float64)) {
      this.json = deserializeFloat(
        this._dnaManager.type as Type.float64,
        decryptedData.slice(SEGMENT_SIZE - 8) as Bytes<8>,
      ) as T
    } else if (
      isDnaManagerType(this._dnaManager, Type.int8) ||
      isDnaManagerType(this._dnaManager, Type.uint8)
    ) {
      this.json = deserializeInt(this._dnaManager.type, decryptedData.slice(SEGMENT_SIZE - 1)) as T
    } else if (isDnaManagerType(this._dnaManager, Type.int16)) {
      this.json = deserializeInt(this._dnaManager.type, decryptedData.slice(SEGMENT_SIZE - 2)) as T
    } else if (isDnaManagerType(this._dnaManager, Type.int32)) {
      this.json = deserializeInt(this._dnaManager.type, decryptedData.slice(SEGMENT_SIZE - 4)) as T
    } else if (isDnaManagerType(this._dnaManager, Type.int64)) {
      this.json = deserializeInt(this._dnaManager.type, decryptedData.slice(SEGMENT_SIZE - 8)) as T
    }
    // string
    else if (isDnaManagerType(this._dnaManager, Type.string)) {
      this.json = deserializeString(decryptedData) as T
    }
    // boolean
    else if (isDnaManagerType(this._dnaManager, Type.boolean)) {
      this.json = deserializeBoolean(decryptedData.slice(SEGMENT_SIZE - 1) as Bytes<1>) as T
    }
    // misc types
    else if (isDnaManagerType(this._dnaManager, Type.swarmCac)) {
      this.json = deserializeSwarmCac(decryptedData) as T
    } else if (isDnaManagerType(this._dnaManager, Type.swarmSoc)) {
      this.json = deserializeSwarmSoc(decryptedData) as T
    }
    // container types
    else if (isDnaManagerType(this._dnaManager, Type.object)) {
      this.deserializeObject(decryptedData)
    } else if (isDnaManagerType(this._dnaManager, Type.array)) {
      this.deserializeArray(decryptedData)
    } else if (isDnaManagerType(this._dnaManager, Type.nullableArray)) {
      this.deserializeNullableArray(decryptedData)
    } else if (isDnaManagerType(this._dnaManager, Type.nullableObject)) {
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
      encryptDecrypt(this._dnaManager.obfuscationKey, bytes)

      return bytes
    }
    if (isBeeSonType(this, Type.float64)) {
      const bytes = segmentPaddingFromLeft(serializeFloat(this._json, Type.float64))
      encryptDecrypt(this._dnaManager.obfuscationKey, bytes)

      return bytes
    }
    if (isBeeSonType(this, Type.int8)) {
      const bytes = segmentPaddingFromLeft(serliazeInt(this._json, Type.int8))
      encryptDecrypt(this._dnaManager.obfuscationKey, bytes)

      return bytes
    }
    if (isBeeSonType(this, Type.uint8)) {
      const bytes = segmentPaddingFromLeft(serliazeInt(this._json, Type.uint8))
      encryptDecrypt(this._dnaManager.obfuscationKey, bytes)

      return bytes
    }
    if (isBeeSonType(this, Type.int16)) {
      const bytes = segmentPaddingFromLeft(serliazeInt(this._json, Type.int16))
      encryptDecrypt(this._dnaManager.obfuscationKey, bytes)

      return bytes
    }
    if (isBeeSonType(this, Type.int32)) {
      const bytes = segmentPaddingFromLeft(serliazeInt(this._json, Type.int32))
      encryptDecrypt(this._dnaManager.obfuscationKey, bytes)

      return bytes
    }
    if (isBeeSonType(this, Type.int64)) {
      const bytes = segmentPaddingFromLeft(serliazeInt(this._json, Type.int64))
      encryptDecrypt(this._dnaManager.obfuscationKey, bytes)

      return bytes
    }
    // string
    if (isBeeSonType(this, Type.string)) {
      const bytes = segmentPaddingFromRight(serializeString(this._json))
      encryptDecrypt(this._dnaManager.obfuscationKey, bytes)

      return bytes
    }
    // boolean
    if (isBeeSonType(this, Type.boolean)) {
      const bytes = segmentPaddingFromRight(serializeBoolean(this._json))
      encryptDecrypt(this._dnaManager.obfuscationKey, bytes)

      return bytes
    }
    // misc types
    if (isBeeSonType(this, Type.swarmCac)) {
      const bytes = serializeSwarmCac(this._json as SwarmManifestCid)
      encryptDecrypt(this._dnaManager.obfuscationKey, bytes)

      return bytes
    }
    if (isBeeSonType(this, Type.swarmSoc)) {
      const bytes = serializeSwarmSoc(this.json as SwarmFeedCid)
      encryptDecrypt(this._dnaManager.obfuscationKey, bytes)

      return bytes
    }
    // container types
    if (isDnaManagerType(this._dnaManager, Type.object) || isDnaManagerType(this._dnaManager, Type.array)) {
      return this.serializeContainerElementsData()
    }
    if (
      isDnaManagerType(this._dnaManager, Type.nullableObject) ||
      isDnaManagerType(this._dnaManager, Type.nullableArray)
    ) {
      return new Uint8Array([
        ...this.serializeContainerElementsNulls(),
        ...this.serializeContainerElementsData(),
      ])
    }

    throw new NotSupportedTypeError(this.dnaManager.type)
  }

  public setIndexNullable(index: keyof T, nullable: boolean) {
    if (isDnaManagerType(this._dnaManager, Type.nullableObject)) {
      for (const [typeDefIndex, typeDefinition] of this._dnaManager.typeDefinitions.entries()) {
        const typeDef = typeDefinition as TypeDefinitionO
        if (typeDef.marker === index) {
          return this._dnaManager.setTypeDefinitionNullable(typeDefIndex, nullable)
        }
      }

      throw new Error(`Index "${index} has been not found"`)
    } else if (isDnaManagerType(this._dnaManager, Type.nullableArray)) {
      return this._dnaManager.setTypeDefinitionNullable(index as number, nullable)
    }
    throw new Error(`BeeSon object is not a nullable container type. It has type: ${this._dnaManager.type}`)
  }

  private serializeContainerElementsData(): Uint8Array {
    if (
      !isDnaManagerType(this._dnaManager, Type.object) &&
      !isDnaManagerType(this._dnaManager, Type.array) &&
      !isDnaManagerType(this._dnaManager, Type.nullableArray) &&
      !isDnaManagerType(this._dnaManager, Type.nullableObject)
    ) {
      throw new Error(`BeeSon is not a (nullable) container type. it has type: ${this.dnaManager.type}`)
    }
    const objectValuesBytes: Uint8Array[] = []
    for (const typeDefinition of this._dnaManager.typeDefinitions) {
      objectValuesBytes.push(typeDefinition.beeSon.serialize({ withoutBlobHeader: true }))
    }

    // objectValuesBytes already 32 bytes padded
    const bytes = flattenBytesArray(objectValuesBytes)
    encryptDecrypt(this._dnaManager.obfuscationKey, bytes)

    return bytes
  }

  /** Serialize Null bitvector for nullable containers in the data implementation */
  private serializeContainerElementsNulls(): Uint8Array {
    if (
      !isDnaManagerType(this._dnaManager, Type.nullableArray) &&
      !isDnaManagerType(this._dnaManager, Type.nullableObject)
    ) {
      throw new Error(`BeeSon is not a nullable container type. it has type: ${this.dnaManager.type}`)
    }

    // const
    const bv = new BitVector(this._dnaManager.typeDefinitions.length)
    if (isDnaManagerType(this._dnaManager, Type.nullableObject)) {
      for (const [index, typeDefinition] of this._dnaManager.typeDefinitions.entries()) {
        const typeDef = typeDefinition as TypeDefinitionO
        if ((this._json as Record<string, unknown>)[typeDef.marker] === null) {
          bv.setBit(index)
        }
      }
    } else {
      // it is nullableArray
      for (const [index] of this._dnaManager.typeDefinitions.entries()) {
        if ((this._json as unknown[])[index] === null) {
          bv.setBit(index)
        }
      }
    }

    const vektorSegments = segmentPaddingFromRight(bv.bitVector)
    encryptDecrypt(this._dnaManager.obfuscationKey, vektorSegments)

    return vektorSegments
  }

  /** Deserialize Null bitvector for nullable containers in the data implementation */
  private deserializeContainerElementsNulls(bitVectorSegments: Uint8Array): BitVector {
    if (
      !isDnaManagerType(this._dnaManager, Type.nullableArray) &&
      !isDnaManagerType(this._dnaManager, Type.nullableObject)
    ) {
      throw new Error(`BeeSon is not a nullable container type. it has type: ${this.dnaManager.type}`)
    }

    const bitVectorBytes = bitVectorSegments.slice(0, Math.ceil(this._dnaManager.typeDefinitions.length / 8))

    return new BitVector(this._dnaManager.typeDefinitions.length, bitVectorBytes)
  }

  private deserializeObject(data: Uint8Array) {
    if (!isDnaManagerType(this._dnaManager, Type.object)) throw new Error(`DNA type is not a ${Type.object}`)
    const obj: Record<string, unknown> = {}
    let segmentOffset = 0
    for (const typeDefinition of this._dnaManager.typeDefinitions) {
      const typeDef = typeDefinition as TypeDefinitionO
      const key = typeDef.marker
      const offset = segmentOffset * SEGMENT_SIZE
      const endOffset = typeDef.segmentLength ? offset + typeDef.segmentLength * SEGMENT_SIZE : undefined
      if (isContainerType(typeDef.beeSon.dnaManager.type)) {
        typeDef.beeSon = BeeSon.deserialize(data.slice(offset, endOffset), {
          // dnamanager type/obfuscationkey and else is set already on dna deserialisation
          obfuscationKey: typeDef.beeSon.dnaManager.obfuscationKey,
          type: typeDef.beeSon.dnaManager.type,
          version: typeDef.beeSon.dnaManager.version,
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
    if (!isDnaManagerType(this._dnaManager, Type.nullableObject)) {
      throw new Error(`DNA type is not a ${Type.object}`)
    }
    const obj: Record<string, unknown> = {}
    let segmentOffset = segmentSize(Math.ceil(this._dnaManager.typeDefinitions.length / 8))
    const bitVector = this.deserializeContainerElementsNulls(data.slice(0, segmentOffset * SEGMENT_SIZE))
    for (const [i, typeDefinition] of this._dnaManager.typeDefinitions.entries()) {
      const typeDef = typeDefinition as TypeDefinitionO
      const key = typeDef.marker
      if (bitVector.getBit(i)) {
        typeDefinition.beeSon.json = null
        obj[key] = typeDefinition.beeSon.json

        continue
      }
      const offset = segmentOffset * SEGMENT_SIZE
      const endOffset = typeDef.segmentLength ? offset + typeDef.segmentLength * SEGMENT_SIZE : undefined
      if (isContainerType(typeDef.beeSon.dnaManager.type)) {
        typeDef.beeSon = BeeSon.deserialize(data.slice(offset, endOffset), {
          // dnamanager type/obfuscationkey and else is set already on dna deserialisation
          obfuscationKey: typeDef.beeSon.dnaManager.obfuscationKey,
          type: typeDef.beeSon.dnaManager.type,
          version: typeDef.beeSon.dnaManager.version,
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
    if (!isDnaManagerType(this._dnaManager, Type.nullableArray)) {
      throw new Error(`DNA type is not a ${Type.object}`)
    }
    const arr: unknown[] = []
    let segmentOffset = segmentSize(Math.ceil(this._dnaManager.typeDefinitions.length / 8))
    const bitVector = this.deserializeContainerElementsNulls(data.slice(0, segmentOffset * SEGMENT_SIZE))
    for (const [i, typeDefinition] of this._dnaManager.typeDefinitions.entries()) {
      if (bitVector.getBit(i)) {
        typeDefinition.beeSon.json = null
        arr.push(typeDefinition.beeSon.json)

        continue
      }

      const typeDef = typeDefinition
      const offset = segmentOffset * SEGMENT_SIZE
      const endOffset = typeDef.segmentLength ? offset + typeDef.segmentLength * SEGMENT_SIZE : undefined
      if (isContainerType(typeDef.beeSon.dnaManager.type)) {
        typeDef.beeSon = BeeSon.deserialize(data.slice(offset, endOffset), {
          // dnamanager type/obfuscationkey and else is set already on dna deserialisation
          obfuscationKey: typeDef.beeSon.dnaManager.obfuscationKey,
          type: typeDef.beeSon.dnaManager.type,
          version: typeDef.beeSon.dnaManager.version,
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
    if (!isDnaManagerType(this._dnaManager, Type.array)) {
      throw new Error(`DNA type is not a ${Type.object}`)
    }
    const arr: unknown[] = []
    let segmentOffset = 0
    for (const typeDefinition of this._dnaManager.typeDefinitions) {
      const typeDef = typeDefinition
      const offset = segmentOffset * SEGMENT_SIZE
      const endOffset = typeDef.segmentLength ? offset + typeDef.segmentLength * SEGMENT_SIZE : undefined
      if (isContainerType(typeDef.beeSon.dnaManager.type)) {
        typeDef.beeSon = BeeSon.deserialize(data.slice(offset, endOffset), {
          // dnamanager type/obfuscationkey and else is set already on dna deserialisation
          obfuscationKey: typeDef.beeSon.dnaManager.obfuscationKey,
          type: typeDef.beeSon.dnaManager.type,
          version: typeDef.beeSon.dnaManager.version,
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
    const dnaManager = this._dnaManager.getNullableContainerDnaManager()
    const newBeeSon = new BeeSon({ dnaManager: dnaManager })
    newBeeSon.json = this.json

    return newBeeSon as NullableContainerBeeSon<T>
  }
}
