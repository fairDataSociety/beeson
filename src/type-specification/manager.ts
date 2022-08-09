import { BeeSon } from '../beeson'
import {
  assertBeeSonType,
  deserializeType,
  JsonValue,
  serializeType,
  Type,
  ValueType,
  ContainerTypes,
  StorageLoader,
  SUPER_BEESON_TYPE,
  isReference,
} from '../types'
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
import { deserializeArray, deserializeNullableArray, serializeArray, serializeNullableArray } from './array'
import {
  deserializeNullableObject,
  deserializeObject,
  serializeNullableObject,
  serializeObject,
} from './object'
import { makeChunkedFile } from '@fairdatasociety/bmt-js'

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
  typeSpecification: DnaObject<Type>
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

function isDnaObjectType<T extends Type>(
  typeSpecificationObject: DnaObject<Type>,
  type: T,
): typeSpecificationObject is DnaObject<T> {
  return typeSpecificationObject.type === type
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
  ? TypeSpecification<Type.nullableArray>
  : T extends Type.object
  ? TypeSpecification<Type.nullableObject>
  : never

export class TypeSpecification<T extends Type> {
  /**
   * The serialisation will happen with the DNA referenced short version instead of serializing the typeSpecificaiton
   * OR the deserialization happened from DNA implementation
   */
  public superBeeSon = false
  constructor(
    public obfuscationKey: Bytes<32>,
    private _version: Version,
    private _type: T,
    private _typeDefinitions: TypeDefinitions<T>,
    /** if the JSONValue is nullable according to its parent container's field defintion */
    public nullable = false,
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
   * Asserts whether the given JsonValue satisfies its corresponding TypeSpecification
   * Container typed values have shallow assertion as their elements will have own BeeSon object anyway.
   */
  // eslint-disable-next-line complexity
  public assertJsonValue(value: unknown): asserts value is JsonValue {
    if (this.nullable && isNull(value)) return
    if (isTypeSpecificaitonManagerType(this, Type.swarmCac)) {
      return assertSwarmManifestCid(value)
    }
    if (isTypeSpecificaitonManagerType(this, Type.swarmSoc)) {
      return assertSwarmFeedCid(value)
    }
    if (
      isTypeSpecificaitonManagerType(this, Type.float32) ||
      isTypeSpecificaitonManagerType(this, Type.float64)
    ) {
      return assertNumber(value)
    }
    if (
      isTypeSpecificaitonManagerType(this, Type.uint8) ||
      isTypeSpecificaitonManagerType(this, Type.int8) ||
      isTypeSpecificaitonManagerType(this, Type.int16) ||
      isTypeSpecificaitonManagerType(this, Type.int32)
    ) {
      return assertInteger(value)
    }
    if (isTypeSpecificaitonManagerType(this, Type.int64)) {
      return assertBigInt(value)
    }
    if (isTypeSpecificaitonManagerType(this, Type.string)) {
      return assertString(value)
    }
    if (
      isTypeSpecificaitonManagerType(this, Type.array) ||
      isTypeSpecificaitonManagerType(this, Type.nullableArray)
    ) {
      assertArray(value)
      const typeDefs = this.typeDefinitions as TypeDefinitionA[]
      if (value.length !== typeDefs.length) {
        throw new Error(
          `Given JSON array has ${value.length} length, when the typeSpecification defines ${typeDefs.length} length`,
        )
      }

      return
    }
    if (
      isTypeSpecificaitonManagerType(this, Type.object) ||
      isTypeSpecificaitonManagerType(this, Type.nullableObject)
    ) {
      assertObject(value)
      const objectKeys = Object.keys(value)
      const typeDefs = this.typeDefinitions as TypeDefinitionO[]
      if (objectKeys.length !== typeDefs.length) {
        const typeDefKeys = typeDefs.map(def => def.marker)
        throw new Error(
          `Given JSON object has ${objectKeys.length} key length, when the typeSpecification defines ${
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
    if (isTypeSpecificaitonManagerType(this, Type.boolean)) {
      return assertBoolean(value)
    }
    if (isTypeSpecificaitonManagerType(this, Type.null)) {
      return assertNull(value)
    }

    throw new Error(
      `TypeSpecification assertion problem at value "${value}". There is no corresponding check`,
    )
  }

  public getTypeSpecificationObject(): DnaObject<T> {
    if (isTypeSpecificaitonManagerType(this, Type.array)) {
      return {
        type: this._type,
        children: this._typeDefinitions.map(typeDef => {
          return {
            segmentLength: typeDef.segmentLength,
            typeSpecification: typeDef.beeSon.typeSpecificationManager.getTypeSpecificationObject(),
          }
        }) as DnaChildren<T>,
      }
    } else if (isTypeSpecificaitonManagerType(this, Type.nullableArray)) {
      return {
        type: this._type,
        children: this._typeDefinitions.map(typeDef => {
          return {
            segmentLength: typeDef.segmentLength,
            typeSpecification: typeDef.beeSon.typeSpecificationManager.getTypeSpecificationObject(),
            nullable: typeDef.beeSon.typeSpecificationManager.nullable,
          }
        }) as DnaChildren<T>,
      }
    } else if (isTypeSpecificaitonManagerType(this, Type.nullableObject)) {
      return {
        type: this._type,
        children: this._typeDefinitions.map(typeDef => {
          return {
            segmentLength: typeDef.segmentLength,
            typeSpecification: typeDef.beeSon.typeSpecificationManager.getTypeSpecificationObject(),
            nullable: typeDef.beeSon.typeSpecificationManager.nullable,
            marker: typeDef.marker,
          }
        }) as DnaChildren<T>,
      }
    } else if (isTypeSpecificaitonManagerType(this, Type.object)) {
      return {
        type: this._type,
        children: this._typeDefinitions.map(typeDef => {
          return {
            segmentLength: typeDef.segmentLength,
            typeSpecification: typeDef.beeSon.typeSpecificationManager.getTypeSpecificationObject(),
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
  public serialize(withoutBlobHeader = false): Uint8Array {
    const header = withoutBlobHeader ? new Uint8Array() : this.typeSpecificationHeader()

    // if the serialization is not root object and it is a superbeeson, there is no need for typespec
    if (withoutBlobHeader && this.superBeeSon) {
      return new Uint8Array()
    }

    let typeSpecification: Uint8Array

    if (isTypeSpecificaitonManagerType(this, Type.array)) {
      typeSpecification = serializeArray(this as TypeSpecification<Type.array>)
    } else if (this._type === Type.object) {
      typeSpecification = serializeObject(this as TypeSpecification<Type.object>)
    } else if (this._type === Type.nullableArray) {
      typeSpecification = serializeNullableArray(this as TypeSpecification<Type.nullableArray>)
    } else if (this._type === Type.nullableObject) {
      typeSpecification = serializeNullableObject(this as TypeSpecification<Type.nullableObject>)
    } else {
      // cannot be superBeeson if the type is not containerType
      return header // no padding required
    }
    typeSpecification = segmentPaddingFromRight(typeSpecification)
    encryptDecrypt(this.obfuscationKey, typeSpecification)

    // in case of SuperBeeSon only the typespecification's BMT address will be returned.
    if (!withoutBlobHeader && this.superBeeSon) {
      this.superBeeSon = false
      const superBeeSonHeader = this.typeSpecificationHeader()
      this.superBeeSon = true
      const dnaReference = makeChunkedFile(
        new Uint8Array([...superBeeSonHeader, ...typeSpecification]),
      ).address()

      return new Uint8Array([...header, ...dnaReference])
    }

    return new Uint8Array([...header, ...typeSpecification])
  }

  public typeSpecificationHeader(): Bytes<64> {
    const data = new Uint8Array([
      ...serializeVersion(this._version),
      ...new Uint8Array(26),
      ...serializeType(this.superBeeSon ? SUPER_BEESON_TYPE : this._type),
    ]) // should be 32 bytes
    encryptDecrypt(this.obfuscationKey, data)

    return new Bytes([...this.obfuscationKey, ...data])
  }

  /**
   * Initialize TypeManager class
   *
   * @param data DNA datablob (header + typeSpecification)
   * @param header BeeSon header
   * @returns typeSpecificationManager with the processed bytes length
   */
  public static async deserialize<T extends Type>(
    data: Uint8Array,
    header?: Header<T> | undefined,
    storageLoader?: StorageLoader,
  ): Promise<{ typeSpecificationManager: TypeSpecification<T>; processedBytes: number }> {
    let processedBytes = 0
    const headerIsPredefined = Boolean(header)
    if (!header) {
      // `data` has to have header in order to identify the beeson type, otherwise error
      header = TypeSpecification.deserializeHeader(
        data.slice(0, HEADER_BYTE_LENGTH) as Bytes<64>,
      ) as Header<T>
      data = data.slice(HEADER_BYTE_LENGTH)
      processedBytes = HEADER_BYTE_LENGTH
    }

    // SuperBeeSon deserialisation that override data for dna
    // if header is not defined in the parameter, it is the root level
    const isRootSuperBeeSon = !headerIsPredefined && isHeaderType(header!, SUPER_BEESON_TYPE)
    if (isRootSuperBeeSon) {
      const typeSepRef = data.slice(0, SEGMENT_SIZE)
      if (!isReference(typeSepRef)) {
        throw new Error(
          `TypeManager deserialization error: header is SuperBeeSonType but its payload is not a Swarm Reference`,
        )
      }
      if (!storageLoader) {
        throw new Error('StorageLoader is not defined on SuperBeeSonType deserialisation')
      }

      data = await storageLoader(typeSepRef)
      //TODO check whether the version is the same that the fetched dna has
      header = TypeSpecification.deserializeHeader(
        data.slice(0, HEADER_BYTE_LENGTH) as Bytes<64>,
      ) as Header<T>
      data = data.slice(HEADER_BYTE_LENGTH)
      processedBytes += 32 // because the typeSepRef has been sliced additionally only
    }

    if (isHeaderType(header!, Type.array)) {
      const {
        typeSpecificationManager: typeSpecificationManager,
        typeSpecificationByteSize: typeSpecificationByteSize,
      } = await deserializeArray(data, header, storageLoader)

      return {
        typeSpecificationManager: typeSpecificationManager as TypeSpecification<T>,
        processedBytes: isRootSuperBeeSon ? processedBytes : processedBytes + typeSpecificationByteSize,
      }
    } else if (isHeaderType(header!, Type.object)) {
      const { typeSpecificationManager, typeSpecificationByteSize } = await deserializeObject(
        data,
        header,
        storageLoader,
      )

      return {
        typeSpecificationManager: typeSpecificationManager as TypeSpecification<T>,
        processedBytes: isRootSuperBeeSon ? processedBytes : processedBytes + typeSpecificationByteSize,
      }
    } else if (isHeaderType(header!, Type.nullableArray)) {
      const {
        typeSpecificationManager: typeSpecificationManager,
        typeSpecificationByteSize: typeSpecificationByteSize,
      } = await deserializeNullableArray(data, header, storageLoader)

      return {
        typeSpecificationManager: typeSpecificationManager as TypeSpecification<T>,
        processedBytes: isRootSuperBeeSon ? processedBytes : processedBytes + typeSpecificationByteSize,
      }
    } else if (isHeaderType(header!, Type.nullableObject)) {
      const { typeSpecificationManager, typeSpecificationByteSize } = await deserializeNullableObject(
        data,
        header,
        storageLoader,
      )

      return {
        typeSpecificationManager: typeSpecificationManager as TypeSpecification<T>,
        processedBytes: isRootSuperBeeSon ? processedBytes : processedBytes + typeSpecificationByteSize,
      }
    }

    return {
      typeSpecificationManager: new TypeSpecification(
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
    const versionBytes = decryptedBytes.slice(0, 4) as Bytes<4>
    const version = deserializeVersion(versionBytes)
    const type = deserializeType(decryptedBytes.slice(30) as Bytes<2>)

    // version check
    if (!equalBytes(versionBytes, serializeVersion(Version.unpackedV0_1))) {
      throw new Error(`Not a valid BeeSon version hash`)
    }

    assertBeeSonType(type)

    return {
      type,
      version,
      obfuscationKey,
    }
  }

  public static loadDnaRootObject<T extends Type>(typeSpecification: DnaRootObject<T>): TypeSpecification<T> {
    return TypeSpecification.loadDnaObject(
      typeSpecification,
      typeSpecification.obfuscationKey,
      typeSpecification.version,
    )
  }

  public static loadDnaObject<T extends Type>(
    typeSpecification: DnaObject<T>,
    obfuscationKey: Bytes<32> = new Bytes(32),
    version = Version.unpackedV0_1,
    nullable = false,
  ): TypeSpecification<T> {
    assertObfuscationKey(obfuscationKey)
    assertVersion(version)

    if (isDnaObjectType(typeSpecification, Type.array)) {
      const typeDefinitions: TypeDefinitionA[] = typeSpecification.children.map(child => {
        return {
          segmentLength: child.segmentLength,
          beeSon: new BeeSon({
            typeSpecificationManager: TypeSpecification.loadDnaObject(
              child.typeSpecification,
              obfuscationKey,
              version,
            ) as TypeSpecification<any>,
            obfuscationKey,
          }),
        }
      })

      return new TypeSpecification(
        obfuscationKey,
        version,
        Type.array,
        typeDefinitions,
        nullable,
      ) as TypeSpecification<T>
    } else if (isDnaObjectType(typeSpecification, Type.nullableArray)) {
      const typeDefinitions: TypeDefinitionA[] = typeSpecification.children.map(child => {
        return {
          segmentLength: child.segmentLength,
          beeSon: new BeeSon({
            typeSpecificationManager: TypeSpecification.loadDnaObject(
              child.typeSpecification,
              obfuscationKey,
              version,
              child.nullable,
            ) as TypeSpecification<any>,
            obfuscationKey,
          }),
        }
      })

      return new TypeSpecification(
        obfuscationKey,
        version,
        Type.nullableArray,
        typeDefinitions,
        nullable,
      ) as TypeSpecification<T>
    } else if (isDnaObjectType(typeSpecification, Type.object)) {
      const typeDefinitions: TypeDefinitionO[] = typeSpecification.children.map(child => {
        return {
          segmentLength: child.segmentLength,
          beeSon: new BeeSon({
            typeSpecificationManager: TypeSpecification.loadDnaObject(
              child.typeSpecification,
              obfuscationKey,
              version,
            ) as TypeSpecification<any>,
            obfuscationKey,
          }),
          marker: child.marker,
        }
      })

      return new TypeSpecification(
        obfuscationKey,
        version,
        Type.object,
        typeDefinitions,
        nullable,
      ) as TypeSpecification<T>
    } else if (isDnaObjectType(typeSpecification, Type.nullableObject)) {
      const typeDefinitions: TypeDefinitionO[] = typeSpecification.children.map(child => {
        return {
          segmentLength: child.segmentLength,
          beeSon: new BeeSon({
            typeSpecificationManager: TypeSpecification.loadDnaObject(
              child.typeSpecification,
              obfuscationKey,
              version,
              child.nullable,
            ) as TypeSpecification<any>,
            obfuscationKey,
          }),
          marker: child.marker,
        }
      })

      return new TypeSpecification(
        obfuscationKey,
        version,
        Type.nullableObject,
        typeDefinitions,
        nullable,
      ) as TypeSpecification<T>
    }

    return new TypeSpecification(
      obfuscationKey,
      version,
      typeSpecification.type,
      null as TypeDefinitions<T>,
      nullable,
    )
  }

  // mutate methods

  /**
   * Set container object element nullable or disallow to be that
   * @throws if the stored json value of the element has conflict with the nullable typeSpecification parameter
   * | (e.g.) TypeSpecification was nullable before and the json value null, and user changes nullable to false
   */
  public setTypeDefinitionNullable(typeDefIndex: number, nullable: boolean) {
    if (!this._typeDefinitions) throw new Error(`Type does not handle a container type`)
    if (
      !isTypeSpecificaitonManagerType(this, Type.nullableArray) &&
      !isTypeSpecificaitonManagerType(this, Type.nullableObject)
    ) {
      throw new Error(`The TypeSpecification does not allow nullable container here`)
    }
    if (!this.typeDefinitions[typeDefIndex]) {
      throw new Error(`there is no typedefintion on index ${typeDefIndex}`)
    }
    const oldBeeSon = this.typeDefinitions[typeDefIndex].beeSon
    const oldDnaManager = oldBeeSon.typeSpecificationManager
    const oldTypeDefs = Array.isArray(oldDnaManager.typeDefinitions)
      ? [...oldDnaManager.typeDefinitions]
      : oldDnaManager.typeDefinitions
    const newDnaManager = new TypeSpecification(
      oldDnaManager.obfuscationKey,
      oldDnaManager.version,
      oldDnaManager.type,
      oldTypeDefs,
      nullable,
    )
    const newBeeSon = new BeeSon({ typeSpecificationManager: newDnaManager })
    newBeeSon.json = oldBeeSon.json
    //overwrite new beeson object for element
    this.typeDefinitions[typeDefIndex].beeSon = newBeeSon
  }

  public getNullableContainerDnaManager(): NullableContainerDnaManager<T> {
    if (isTypeSpecificaitonManagerType(this, Type.array)) {
      const typeDefinitions = this._typeDefinitions.map(oldTypeDef => {
        const oldBeeSon = oldTypeDef.beeSon
        const oldDnaManager = oldBeeSon.typeSpecificationManager
        const newDnaManager = new TypeSpecification(
          oldDnaManager.obfuscationKey,
          oldDnaManager.version,
          oldDnaManager.type,
          oldDnaManager.typeDefinitions,
          true,
        )
        const newBeeSon = new BeeSon({ typeSpecificationManager: newDnaManager })
        const newTypeDef: TypeDefinitionA = {
          segmentLength: oldTypeDef.segmentLength,
          beeSon: newBeeSon,
        }

        return newTypeDef
      })

      return new TypeSpecification(
        this.obfuscationKey,
        this.version,
        Type.nullableArray,
        typeDefinitions,
      ) as NullableContainerDnaManager<T>
    }
    if (isTypeSpecificaitonManagerType(this, Type.object)) {
      const typeDefinitions = this._typeDefinitions.map(oldTypeDef => {
        const oldBeeSon = oldTypeDef.beeSon
        const oldDnaManager = oldBeeSon.typeSpecificationManager
        const newDnaManager = new TypeSpecification(
          oldDnaManager.obfuscationKey,
          oldDnaManager.version,
          oldDnaManager.type,
          oldDnaManager.typeDefinitions,
          true,
        )
        const newBeeSon = new BeeSon({ typeSpecificationManager: newDnaManager })
        const newTypeDef: TypeDefinitionO = {
          ...oldTypeDef,
          beeSon: newBeeSon,
        }

        return newTypeDef
      })

      return new TypeSpecification(
        this.obfuscationKey,
        this.version,
        Type.nullableObject,
        typeDefinitions,
      ) as NullableContainerDnaManager<T>
    }

    throw new Error(`This TypeSpecification does not represent a nullable container value`)
  }
}

export function generateDna<T extends JsonValue>(
  json: T,
  obfuscationKey?: Bytes<32>,
): TypeSpecification<ValueType<T>> {
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

    return new TypeSpecification(
      obfuscationKey,
      version,
      type,
      typeDefinitions as TypeDefinitions<ValueType<T>>,
    )
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

    return new TypeSpecification(
      obfuscationKey,
      version,
      type,
      typeDefinitions as TypeDefinitions<ValueType<T>>,
    )
  }

  return new TypeSpecification(obfuscationKey, version, type, null as TypeDefinitions<ValueType<T>>)
}

export function isTypeSpecificaitonManagerType<T extends Type>(
  typeSpecificationManager: TypeSpecification<Type>,
  type: T,
): typeSpecificationManager is TypeSpecification<T> {
  return typeSpecificationManager.type === type
}

export function isTypeManagerContainerType(
  typeManager: TypeSpecification<Type>,
): typeManager is TypeSpecification<ContainerTypes> {
  return (
    isTypeSpecificaitonManagerType(typeManager, Type.array) ||
    isTypeSpecificaitonManagerType(typeManager, Type.object) ||
    isTypeSpecificaitonManagerType(typeManager, Type.nullableArray) ||
    isTypeSpecificaitonManagerType(typeManager, Type.nullableObject)
  )
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
