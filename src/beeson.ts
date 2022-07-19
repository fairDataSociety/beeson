import {
  TypeSpecification,
  generateDna,
  Header,
  isTypeSpecificaitonManagerType,
  TypeDefinitionO,
} from './type-specification'
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
  return (beeSon as BeeSon<JsonValue>).typeSpecificationManager.type === type
}

interface JsonParams<T extends JsonValue> {
  json: T
  obfuscationKey?: Bytes<32>
}

interface DnaParams<T extends JsonValue = JsonValue> {
  typeSpecificationManager: TypeSpecification<ValueType<T>>
}

function isDnaParams<T extends JsonValue>(params: unknown): params is DnaParams<T> {
  return typeof params === 'object' && Object.keys(params as object).includes('typeSpecificationManager')
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
  private _typeSpecification: TypeSpecification<ValueType<T>>
  private _json: T | undefined

  constructor(params: JsonParams<T> | DnaParams<T>) {
    if (isDnaParams(params)) {
      this._typeSpecification = params.typeSpecificationManager
    } else if (isJsonParams(params)) {
      this._json = params.json
      this._typeSpecification = generateDna(this._json)
    } else throw new Error(`Invalid BeeSon constructor parameters`)
  }

  // Setters/getters

  /** TypeSpecification manager instance of the BeeSon value */
  public get typeSpecificationManager(): TypeSpecification<ValueType<T>> {
    return this._typeSpecification
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
   * Set BeeSon value according to its corresponding TypeSpecification or Type
   */
  public set json(value: T) {
    this._typeSpecification.assertJsonValue(value)

    if (this._typeSpecification.nullable && isNull(value)) {
      this._json = value

      return
    }
    if (
      isTypeSpecificaitonManagerType(this._typeSpecification, Type.array) ||
      isTypeSpecificaitonManagerType(this._typeSpecification, Type.nullableArray)
    ) {
      for (const [index, typeDefition] of this._typeSpecification.typeDefinitions.entries()) {
        try {
          const arrayItem = (value as Array<unknown>)[index]
          typeDefition.beeSon.json = arrayItem as JsonValue
        } catch (e) {
          throw new Error(`BeeSon Array assertion problem at index ${index}: ${(e as Error).message}`)
        }
      }
    } else if (
      isTypeSpecificaitonManagerType(this._typeSpecification, Type.object) ||
      isTypeSpecificaitonManagerType(this._typeSpecification, Type.nullableObject)
    ) {
      for (const typeDefinition of this._typeSpecification.typeDefinitions) {
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
    const typeSpecificationBytes = this.serializeDna(withoutBlobHeader)

    if (
      isTypeSpecificaitonManagerType(this._typeSpecification, Type.array) ||
      isTypeSpecificaitonManagerType(this._typeSpecification, Type.object) ||
      isTypeSpecificaitonManagerType(this._typeSpecification, Type.nullableArray) ||
      isTypeSpecificaitonManagerType(this._typeSpecification, Type.nullableObject)
    ) {
      const containerBytes: Uint8Array[] = [typeSpecificationBytes]
      if (
        isTypeSpecificaitonManagerType(this._typeSpecification, Type.nullableArray) ||
        isTypeSpecificaitonManagerType(this._typeSpecification, Type.nullableObject)
      ) {
        containerBytes.push(this.serializeContainerElementsNulls())
        for (const typeDefition of this._typeSpecification.typeDefinitions) {
          if (!(typeDefition.beeSon._typeSpecification.nullable && typeDefition.beeSon.json === null)) {
            containerBytes.push(typeDefition.beeSon.serialize({ withoutBlobHeader: true }))
          }
        }
      } else {
        for (const typeDefition of this._typeSpecification.typeDefinitions) {
          containerBytes.push(typeDefition.beeSon.serialize({ withoutBlobHeader: true }))
        }
      }

      return flattenBytesArray(containerBytes)
    }

    return new Uint8Array([...typeSpecificationBytes, ...this.serializeData()])
  }

  /** deserialise unpacked data */
  public static deserialize(data: Uint8Array, header?: Header<Type>): BeeSon<JsonValue> {
    const { typeSpecificationManager, processedBytes } = TypeSpecification.deserialize(data, header)
    const beeSon = new BeeSon({ typeSpecificationManager: typeSpecificationManager })
    beeSon.deserializeData(data.slice(processedBytes))

    return beeSon
  }

  private serializeDna(withoutBlobHeader: boolean): Uint8Array {
    return this._typeSpecification.serialize(withoutBlobHeader)
  }

  public deserializeData(data: Uint8Array): void {
    const decryptedData = new Uint8Array([...data])
    encryptDecrypt(this._typeSpecification.obfuscationKey, decryptedData)
    // numbers
    if (isTypeSpecificaitonManagerType(this._typeSpecification, Type.float32)) {
      this.json = deserializeFloat(
        this._typeSpecification.type as Type.float32,
        decryptedData.slice(SEGMENT_SIZE - 4) as Bytes<4>,
      ) as T
    } else if (isTypeSpecificaitonManagerType(this._typeSpecification, Type.float64)) {
      this.json = deserializeFloat(
        this._typeSpecification.type as Type.float64,
        decryptedData.slice(SEGMENT_SIZE - 8) as Bytes<8>,
      ) as T
    } else if (
      isTypeSpecificaitonManagerType(this._typeSpecification, Type.int8) ||
      isTypeSpecificaitonManagerType(this._typeSpecification, Type.uint8)
    ) {
      this.json = deserializeInt(this._typeSpecification.type, decryptedData.slice(SEGMENT_SIZE - 1)) as T
    } else if (isTypeSpecificaitonManagerType(this._typeSpecification, Type.int16)) {
      this.json = deserializeInt(this._typeSpecification.type, decryptedData.slice(SEGMENT_SIZE - 2)) as T
    } else if (isTypeSpecificaitonManagerType(this._typeSpecification, Type.int32)) {
      this.json = deserializeInt(this._typeSpecification.type, decryptedData.slice(SEGMENT_SIZE - 4)) as T
    } else if (isTypeSpecificaitonManagerType(this._typeSpecification, Type.int64)) {
      this.json = deserializeInt(this._typeSpecification.type, decryptedData.slice(SEGMENT_SIZE - 8)) as T
    }
    // string
    else if (isTypeSpecificaitonManagerType(this._typeSpecification, Type.string)) {
      this.json = deserializeString(decryptedData) as T
    }
    // boolean
    else if (isTypeSpecificaitonManagerType(this._typeSpecification, Type.boolean)) {
      this.json = deserializeBoolean(decryptedData.slice(SEGMENT_SIZE - 1) as Bytes<1>) as T
    }
    // misc types
    else if (isTypeSpecificaitonManagerType(this._typeSpecification, Type.swarmCac)) {
      this.json = deserializeSwarmCac(decryptedData) as T
    } else if (isTypeSpecificaitonManagerType(this._typeSpecification, Type.swarmSoc)) {
      this.json = deserializeSwarmSoc(decryptedData) as T
    }
    // container types
    else if (isTypeSpecificaitonManagerType(this._typeSpecification, Type.object)) {
      this.deserializeObject(decryptedData)
    } else if (isTypeSpecificaitonManagerType(this._typeSpecification, Type.array)) {
      this.deserializeArray(decryptedData)
    } else if (isTypeSpecificaitonManagerType(this._typeSpecification, Type.nullableArray)) {
      this.deserializeNullableArray(decryptedData)
    } else if (isTypeSpecificaitonManagerType(this._typeSpecification, Type.nullableObject)) {
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
      encryptDecrypt(this._typeSpecification.obfuscationKey, bytes)

      return bytes
    }
    if (isBeeSonType(this, Type.float64)) {
      const bytes = segmentPaddingFromLeft(serializeFloat(this._json, Type.float64))
      encryptDecrypt(this._typeSpecification.obfuscationKey, bytes)

      return bytes
    }
    if (isBeeSonType(this, Type.int8)) {
      const bytes = segmentPaddingFromLeft(serliazeInt(this._json, Type.int8))
      encryptDecrypt(this._typeSpecification.obfuscationKey, bytes)

      return bytes
    }
    if (isBeeSonType(this, Type.uint8)) {
      const bytes = segmentPaddingFromLeft(serliazeInt(this._json, Type.uint8))
      encryptDecrypt(this._typeSpecification.obfuscationKey, bytes)

      return bytes
    }
    if (isBeeSonType(this, Type.int16)) {
      const bytes = segmentPaddingFromLeft(serliazeInt(this._json, Type.int16))
      encryptDecrypt(this._typeSpecification.obfuscationKey, bytes)

      return bytes
    }
    if (isBeeSonType(this, Type.int32)) {
      const bytes = segmentPaddingFromLeft(serliazeInt(this._json, Type.int32))
      encryptDecrypt(this._typeSpecification.obfuscationKey, bytes)

      return bytes
    }
    if (isBeeSonType(this, Type.int64)) {
      const bytes = segmentPaddingFromLeft(serliazeInt(this._json, Type.int64))
      encryptDecrypt(this._typeSpecification.obfuscationKey, bytes)

      return bytes
    }
    // string
    if (isBeeSonType(this, Type.string)) {
      const bytes = segmentPaddingFromRight(serializeString(this._json))
      encryptDecrypt(this._typeSpecification.obfuscationKey, bytes)

      return bytes
    }
    // boolean
    if (isBeeSonType(this, Type.boolean)) {
      const bytes = segmentPaddingFromRight(serializeBoolean(this._json))
      encryptDecrypt(this._typeSpecification.obfuscationKey, bytes)

      return bytes
    }
    // misc types
    if (isBeeSonType(this, Type.swarmCac)) {
      const bytes = serializeSwarmCac(this._json as SwarmManifestCid)
      encryptDecrypt(this._typeSpecification.obfuscationKey, bytes)

      return bytes
    }
    if (isBeeSonType(this, Type.swarmSoc)) {
      const bytes = serializeSwarmSoc(this.json as SwarmFeedCid)
      encryptDecrypt(this._typeSpecification.obfuscationKey, bytes)

      return bytes
    }
    // container types
    if (
      isTypeSpecificaitonManagerType(this._typeSpecification, Type.object) ||
      isTypeSpecificaitonManagerType(this._typeSpecification, Type.array)
    ) {
      return this.serializeContainerElementsData()
    }
    if (
      isTypeSpecificaitonManagerType(this._typeSpecification, Type.nullableObject) ||
      isTypeSpecificaitonManagerType(this._typeSpecification, Type.nullableArray)
    ) {
      return new Uint8Array([
        ...this.serializeContainerElementsNulls(),
        ...this.serializeContainerElementsData(),
      ])
    }

    throw new NotSupportedTypeError(this.typeSpecificationManager.type)
  }

  public setIndexNullable(index: keyof T, nullable: boolean) {
    if (isTypeSpecificaitonManagerType(this._typeSpecification, Type.nullableObject)) {
      for (const [typeDefIndex, typeDefinition] of this._typeSpecification.typeDefinitions.entries()) {
        const typeDef = typeDefinition as TypeDefinitionO
        if (typeDef.marker === index) {
          return this._typeSpecification.setTypeDefinitionNullable(typeDefIndex, nullable)
        }
      }

      throw new Error(`Index "${String(index)} has been not found"`)
    } else if (isTypeSpecificaitonManagerType(this._typeSpecification, Type.nullableArray)) {
      return this._typeSpecification.setTypeDefinitionNullable(index as number, nullable)
    }
    throw new Error(
      `BeeSon object is not a nullable container type. It has type: ${this._typeSpecification.type}`,
    )
  }

  private serializeContainerElementsData(): Uint8Array {
    if (
      !isTypeSpecificaitonManagerType(this._typeSpecification, Type.object) &&
      !isTypeSpecificaitonManagerType(this._typeSpecification, Type.array) &&
      !isTypeSpecificaitonManagerType(this._typeSpecification, Type.nullableArray) &&
      !isTypeSpecificaitonManagerType(this._typeSpecification, Type.nullableObject)
    ) {
      throw new Error(
        `BeeSon is not a (nullable) container type. it has type: ${this.typeSpecificationManager.type}`,
      )
    }
    const objectValuesBytes: Uint8Array[] = []
    for (const typeDefinition of this._typeSpecification.typeDefinitions) {
      objectValuesBytes.push(typeDefinition.beeSon.serialize({ withoutBlobHeader: true }))
    }

    // objectValuesBytes already 32 bytes padded
    const bytes = flattenBytesArray(objectValuesBytes)
    encryptDecrypt(this._typeSpecification.obfuscationKey, bytes)

    return bytes
  }

  /** Serialize Null bitvector for nullable containers in the data implementation */
  private serializeContainerElementsNulls(): Uint8Array {
    if (
      !isTypeSpecificaitonManagerType(this._typeSpecification, Type.nullableArray) &&
      !isTypeSpecificaitonManagerType(this._typeSpecification, Type.nullableObject)
    ) {
      throw new Error(
        `BeeSon is not a nullable container type. it has type: ${this.typeSpecificationManager.type}`,
      )
    }

    // const
    const bv = new BitVector(this._typeSpecification.typeDefinitions.length)
    if (isTypeSpecificaitonManagerType(this._typeSpecification, Type.nullableObject)) {
      for (const [index, typeDefinition] of this._typeSpecification.typeDefinitions.entries()) {
        const typeDef = typeDefinition as TypeDefinitionO
        if ((this._json as Record<string, unknown>)[typeDef.marker] === null) {
          bv.setBit(index)
        }
      }
    } else {
      // it is nullableArray
      for (const [index] of this._typeSpecification.typeDefinitions.entries()) {
        if ((this._json as unknown[])[index] === null) {
          bv.setBit(index)
        }
      }
    }

    const vektorSegments = segmentPaddingFromRight(bv.bitVector)
    encryptDecrypt(this._typeSpecification.obfuscationKey, vektorSegments)

    return vektorSegments
  }

  /** Deserialize Null bitvector for nullable containers in the data implementation */
  private deserializeContainerElementsNulls(bitVectorSegments: Uint8Array): BitVector {
    if (
      !isTypeSpecificaitonManagerType(this._typeSpecification, Type.nullableArray) &&
      !isTypeSpecificaitonManagerType(this._typeSpecification, Type.nullableObject)
    ) {
      throw new Error(
        `BeeSon is not a nullable container type. it has type: ${this.typeSpecificationManager.type}`,
      )
    }

    const bitVectorBytes = bitVectorSegments.slice(
      0,
      Math.ceil(this._typeSpecification.typeDefinitions.length / 8),
    )

    return new BitVector(this._typeSpecification.typeDefinitions.length, bitVectorBytes)
  }

  private deserializeObject(data: Uint8Array) {
    if (!isTypeSpecificaitonManagerType(this._typeSpecification, Type.object)) {
      throw new Error(`The TypeSpecification is not a ${Type.object}`)
    }
    const obj: Record<string, unknown> = {}
    let segmentOffset = 0
    for (const typeDefinition of this._typeSpecification.typeDefinitions) {
      const typeDef = typeDefinition as TypeDefinitionO
      const key = typeDef.marker
      const offset = segmentOffset * SEGMENT_SIZE
      const endOffset = typeDef.segmentLength ? offset + typeDef.segmentLength * SEGMENT_SIZE : undefined
      if (isContainerType(typeDef.beeSon.typeSpecificationManager.type)) {
        typeDef.beeSon = BeeSon.deserialize(data.slice(offset, endOffset), {
          // typeSpecificationManager type/obfuscationkey and else are set already on typeSpecification's deserialisation
          obfuscationKey: typeDef.beeSon.typeSpecificationManager.obfuscationKey,
          type: typeDef.beeSon.typeSpecificationManager.type,
          version: typeDef.beeSon.typeSpecificationManager.version,
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
    if (!isTypeSpecificaitonManagerType(this._typeSpecification, Type.nullableObject)) {
      throw new Error(`The TypeSpecification is not a ${Type.object}`)
    }
    const obj: Record<string, unknown> = {}
    let segmentOffset = segmentSize(Math.ceil(this._typeSpecification.typeDefinitions.length / 8))
    const bitVector = this.deserializeContainerElementsNulls(data.slice(0, segmentOffset * SEGMENT_SIZE))
    for (const [i, typeDefinition] of this._typeSpecification.typeDefinitions.entries()) {
      const typeDef = typeDefinition as TypeDefinitionO
      const key = typeDef.marker
      if (bitVector.getBit(i)) {
        typeDefinition.beeSon.json = null
        obj[key] = typeDefinition.beeSon.json

        continue
      }
      const offset = segmentOffset * SEGMENT_SIZE
      const endOffset = typeDef.segmentLength ? offset + typeDef.segmentLength * SEGMENT_SIZE : undefined
      if (isContainerType(typeDef.beeSon.typeSpecificationManager.type)) {
        typeDef.beeSon = BeeSon.deserialize(data.slice(offset, endOffset), {
          // typeSpecificationManager type/obfuscationkey and else are set already on typeSpecification's deserialisation
          obfuscationKey: typeDef.beeSon.typeSpecificationManager.obfuscationKey,
          type: typeDef.beeSon.typeSpecificationManager.type,
          version: typeDef.beeSon.typeSpecificationManager.version,
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
    if (!isTypeSpecificaitonManagerType(this._typeSpecification, Type.nullableArray)) {
      throw new Error(`The TypeSpecification is not a ${Type.object}`)
    }
    const arr: unknown[] = []
    let segmentOffset = segmentSize(Math.ceil(this._typeSpecification.typeDefinitions.length / 8))
    const bitVector = this.deserializeContainerElementsNulls(data.slice(0, segmentOffset * SEGMENT_SIZE))
    for (const [i, typeDefinition] of this._typeSpecification.typeDefinitions.entries()) {
      if (bitVector.getBit(i)) {
        typeDefinition.beeSon.json = null
        arr.push(typeDefinition.beeSon.json)

        continue
      }

      const typeDef = typeDefinition
      const offset = segmentOffset * SEGMENT_SIZE
      const endOffset = typeDef.segmentLength ? offset + typeDef.segmentLength * SEGMENT_SIZE : undefined
      if (isContainerType(typeDef.beeSon.typeSpecificationManager.type)) {
        typeDef.beeSon = BeeSon.deserialize(data.slice(offset, endOffset), {
          obfuscationKey: typeDef.beeSon.typeSpecificationManager.obfuscationKey,
          type: typeDef.beeSon.typeSpecificationManager.type,
          version: typeDef.beeSon.typeSpecificationManager.version,
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
    if (!isTypeSpecificaitonManagerType(this._typeSpecification, Type.array)) {
      throw new Error(`The TypeSpecification is not a ${Type.object}`)
    }
    const arr: unknown[] = []
    let segmentOffset = 0
    for (const typeDefinition of this._typeSpecification.typeDefinitions) {
      const typeDef = typeDefinition
      const offset = segmentOffset * SEGMENT_SIZE
      const endOffset = typeDef.segmentLength ? offset + typeDef.segmentLength * SEGMENT_SIZE : undefined
      if (isContainerType(typeDef.beeSon.typeSpecificationManager.type)) {
        typeDef.beeSon = BeeSon.deserialize(data.slice(offset, endOffset), {
          obfuscationKey: typeDef.beeSon.typeSpecificationManager.obfuscationKey,
          type: typeDef.beeSon.typeSpecificationManager.type,
          version: typeDef.beeSon.typeSpecificationManager.version,
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
    const typeSpecificationManager = this._typeSpecification.getNullableContainerDnaManager()
    const newBeeSon = new BeeSon({ typeSpecificationManager })
    newBeeSon.json = this.json

    return newBeeSon as NullableContainerBeeSon<T>
  }
}
