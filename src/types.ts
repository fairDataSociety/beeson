import { SwarmFeedCid, SwarmManifestCid } from './marshalling/address-serializer'

export type JsonMap<T> = {
  [K in keyof T]: JsonValue
}

/** string types, numeric types, misc types, container types */
export enum Type {
  null = 0,
  boolean = 1,
  float32 = 2,
  float64 = 3,
  string = 8,
  uint8 = 16,
  int8 = 17,
  int16 = 25,
  int32 = 29,
  int64 = 31,
  array = 32,
  nullableArray = 33,
  object = 64,
  nullableObject = 65,
  swarmCac = 128,
  swarmSoc = 132,
}

export type ContainerTypes = Type.array | Type.object

export type NullableContainerTypes = Type.nullableArray | Type.nullableObject
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
  return Object.values(Type).includes(value as Type)
}

export function assertBeeSonType(value: unknown): asserts value is Type {
  if (!isBeeSonType(value)) {
    throw new Error(`Type "${value}" is not a valid BeeSon type`)
  }
}

export function isContainerType(value: unknown): value is Type.array | Type.object {
  return value === Type.array || value === Type.object
}
