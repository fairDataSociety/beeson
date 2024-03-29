import { SwarmFeedCid, SwarmManifestCid } from './marshalling/address-serializer'
import { deserializeUint16, serializeUint16 } from './marshalling/number-serializer'
import { Bytes } from './utils'

export type JsonMap<T> = {
  [K in keyof T]: JsonValue
}

export type Reference = Bytes<32 | 64>

/**
 * All basic BeeSon types that can be mapped from JSON values such as
 * string types, numeric types, misc types, container types
 */
export enum Type {
  null = 1,
  boolean = 2,
  float32 = 4,
  float64 = 5,
  string = 8,
  uint8 = 64,
  int8 = 65,
  int16 = 97,
  int32 = 113,
  int64 = 121,
  // superBeeSon = 4096, -> special case, handled differently
  array = 8192,
  nullableArray = 8448,
  object = 16384,
  nullableObject = 16640,
  swarmCac = 32768,
  swarmSoc = 33024,
}

export const SUPER_BEESON_TYPE = 4096

export function serializeType(type: Type): Bytes<2> {
  return serializeUint16(type)
}

export function deserializeType(bytes: Bytes<2>): Type {
  return deserializeUint16(bytes)
}

export type StrictContainerTypes = Type.array | Type.object
export type NullableContainerTypes = Type.nullableArray | Type.nullableObject
export type ContainerTypes = Type.array | Type.object | Type.nullableArray | Type.nullableObject
export type NullableContainerType<T extends Type.array | Type.object> = T extends Type.array
  ? Type.nullableArray
  : T extends Type.object
  ? Type.nullableObject
  : never

export type TypeValue<T extends Type> = T extends Type.array | Type.nullableArray
  ? Array<unknown>
  : T extends Type.boolean
  ? boolean
  : T extends Type.float32 | Type.float64 | Type.int8 | Type.uint8 | Type.int16 | Type.int32
  ? number
  : T extends Type.int64
  ? BigInt
  : T extends Type.object | Type.nullableObject
  ? JsonMap<unknown>
  : T extends Type.string
  ? string
  : T extends Type.swarmCac
  ? SwarmManifestCid
  : T extends Type.swarmSoc
  ? SwarmFeedCid
  : T extends Type.null
  ? null
  : never

export type JsonValue =
  | boolean
  | number
  | JsonMap<unknown>
  | string
  | SwarmManifestCid
  | SwarmFeedCid
  | unknown[]
  | BigInt
  | null

export type ValueType<T extends JsonValue> = T extends Array<unknown>
  ? Type.array | Type.nullableArray
  : T extends boolean
  ? Type.boolean
  : T extends number
  ? Type.float32 | Type.float64 | Type.int8 | Type.uint8 | Type.int16 | Type.int32
  : T extends BigInt
  ? Type.int64
  : T extends string
  ? Type.string
  : T extends SwarmManifestCid
  ? Type.swarmCac
  : T extends SwarmFeedCid
  ? Type.swarmSoc
  : T extends null
  ? Type.null
  : T extends JsonMap<T>
  ? Type.object | Type.nullableObject
  : never

export type Nullable<T> = {
  [P in keyof T]: T[P] | null
}

export class NotSupportedTypeError extends Error {
  constructor(expectedType: number) {
    super(`Type ${expectedType} is not a supported BeeSon type`)
  }
}

export function isBeeSonType(value: unknown): value is Type {
  return value === SUPER_BEESON_TYPE || Object.values(Type).includes(value as Type)
}

export function assertBeeSonType(value: unknown): asserts value is Type {
  if (!isBeeSonType(value)) {
    throw new Error(`Type "${value}" is not a valid BeeSon type`)
  }
}

export function isContainerType(value: unknown): value is Type.array | Type.object {
  return value === Type.array || value === Type.object
}

export type StorageLoader = (reference: Reference) => Promise<Uint8Array>

export function isReference(value: unknown): value is Reference {
  return value instanceof Uint8Array && (value.length === 32 || value.length === 64)
}
