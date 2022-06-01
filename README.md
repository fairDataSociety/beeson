# BeeSon

BeeSon is a JSON compatible serialization format which allows to its elements be verified cheaply on-chain.

> blockchain-verifiable, extensible encapsulation for schema-based object notation in Swarm

# Types

In JSON, values must be one of the following data types:

* a string
* a number
* an object (JSON object)
* an array
* a boolean
* null

Nonetheless, in byte representation it is required to have more strict types.
The following types are possible _currently_ to be serialized in BeeSon:

| Type | Value | JSON Type |
| ---- | ---- | ----------- |
| null | 0 | null |
| boolean | 1 | boolean |
| float32 | 2 | number |
| float64 | 3 | number |
| string | 8 | string |
| uint8 | 16 | number |
| int8 | 17 | number |
| int16 | 25 | number |
| int32 | 29 | number |
| int64 | 31 | number |
| array | 32 | array |
| nullableArray | 33 | array  |
| object | 64 | object |
| nullableObject | 65 | object  |
| swarmCac | 128 | string |
| swarmSoc | 132 | string |

The library defaults the JSON types to the followings:
* `number` (when it does not have decimal value): `int32`
* `number` (when it does have decimal value): `float32`

The `swarmCac` and `swarmSoc` are misc types that are deserialized as regexed strings according to the rules of [Swarm CIDs](https://github.com/ethersphere/swarm-cid-js/). Additionally, the serialization can interpret the CID object used in `swarm-cid-js`.

Of course, these defaults can be overridden by using the library's ABI manager. 


# Marshalling

## BeeSon header

Every BeeSon has to start with a serialised header that consists of
```
┌────────────────────────────────┐
│    obfuscationKey <32 byte>    │
├────────────────────────────────┤
│      versionHash <31 byte>     │
├────────────────────────────────┤
│       blobFlags <1 byte>       │
└────────────────────────────────┘
```
- `obfuscationKey`: random key for encrypted data with which the library will XOR the following data 
- `versionHash`: keccak256 hash of the string `beeson-{version}-{packed/unpacked}`
- `blobFlags`: in BeeSon, it is equal to the [Type](#Type) (similarly as in `typeDefinition`)

## Main structure

```
┌────────────────────────────────┐
│         Header <64 byte>       │
├────────────────────────────────┤
│ (Application Binary Interface) │
├────────────────────────────────┤
│       Data Implementation      │
└────────────────────────────────┘
```

All sections are padded to fit segments (32 bytes), where
- Header is always present at BeeSon types
- Application Binary Interface (ABI) is presented at _container types_ and _misc types_. In other cases, it is omitted.
- Data implementation is the serialized data itself that only stores the value of the data described in the header (and in the ABI).

The elements of the ABI (abiSegmentSize, typeDefinition array, etc.) are packed, but the whole ABI byte serialization is padded to a whole segment.
It is needed, because the data implementation part can start on a new segment which is required for cheap BMT inclusion proofs.
Also, if the ABI is processed the Data Implementation has random access to its elements.

The data implementation also consists of segments where the data type can reserve one or more segments. 
If the data is smaller than a segment (32 bytes) than the data will be padded with zeros for the whole segment.

## Container types

The _arrays_ and _objects_ are container types which can include multiple elements.

In order to describe these elements, it is required to describe where these can be find in the data implementation and how to interpret those.

The ABI describes this interpreation which's structure is stated below by types

### Array

A BeeSon array can be a _strict array_ or a _nullable array_. 
The former one requires every element to be set and cannot take `null` value.
The latter allows to define `null` values at elements which's indices present in the nullable bitVector.

The ABI structure looks like the following (including with the data implementation part for the better understanding)

```
┌────────────────────────────────┐┐
│     abiSegmentSize <2 byte>    ││
├────────────────────────────────┤│
│   typeDefinitonsSize <2 byte>  ││
├────────────────────────────────┤│
│ ┌────────────────────────────┐ ││
│ │      typeDefiniton 1       │ ││
│ ├────────────────────────────┤ ││
│ │            ...             │ ││-> ABI
│ ├────────────────────────────┤ ││
│ │      typeDefiniton N       │ ││
│ └────────────────────────────┘ ││
│ ┌────────────────────────────┐ ││
│ │    (nullable bitVector)    │ ││
│ └────────────────────────────┘ │┘ 
│ ┌────────────────────────────┐ │┐
│ │        dataSegment 1       │ ││
│ ├────────────────────────────┤ ││
│ │            ...             │ ││
│ ├────────────────────────────┤ ││-> Data implementation 
│ │        dataSegment M       │ ││
│ └────────────────────────────┘ ││
└────────────────────────────────┘┘
```
* **abiSegmentSize**: the byte size is `abiSegmentSize * 32` until the Data implementation
* **typeDefintionsSize**: tells how many elements `typeDefiniton array` has (value * 5 bytes long)
* **typeDefinition 1..N**: typeDefinition array consist of 5 bytes elements that represents
```
┌────────────────────────────────┐
│          type <1 byte>         │-> data type of the element that has the same value set like header types
├────────────────────────────────┤
│      segmentLength <4 byte>    │-> how many segments the data implementation reserves
└────────────────────────────────┘
```
* **nullable bitVector**: states which elements can be nulls _only in case of nullableArray container type_
* **dataSegment 1..M**: data implementation part where every data element reserves one or more segments (32 bytes)

### Object

A BeeSon object can be a _strict object_ or a _nullable object_.

In the ABI, the keys have an order that the corresponding typeDefinition position defines.
It prevents a JSON with the same schema (ABI) could be serialized in different ways.

The ABI serialization looks really similar to the [array's ABI](#Array)

```
┌────────────────────────────────┐┐
│     abiSegmentSize <2 byte>    ││
├────────────────────────────────┤│
│   typeDefinitonsSize <2 byte>  ││
├────────────────────────────────┤│
│     (markersLength <2 byte>)   ││
├────────────────────────────────┤│
│ ┌────────────────────────────┐ ││
│ │      typeDefiniton 1       │ ││
│ ├────────────────────────────┤ ││
│ │            ...             │ ││
│ ├────────────────────────────┤ ││
│ │      typeDefiniton N       │ ││
│ └────────────────────────────┘ ││-> ABI
│ ┌────────────────────────────┐ ││
│ │          marker 1          │ ││
│ ├────────────────────────────┤ ││
│ │            ...             │ ││
│ ├────────────────────────────┤ ││
│ │          marker N          │ ││
│ └────────────────────────────┘ ││
│ ┌────────────────────────────┐ ││
│ │    (nullable bitVector)    │ ││
│ └────────────────────────────┘ │┘
│ ┌────────────────────────────┐ │┐
│ │        dataSegment 1       │ ││
│ ├────────────────────────────┤ ││
│ │            ...             │ ││
│ ├────────────────────────────┤ ││-> Data implementation 
│ │        dataSegment M       │ ││
│ └────────────────────────────┘ ││
└────────────────────────────────┘┘
```
and the differences are:
* **markersLength**: states the markers byte length in the ABI _only in case of nullableObject container type_
* **typeDefinition 1..N**: typeDefinition array consist of 7 bytes elements that represents
```
┌────────────────────────────────┐
│          type <1 byte>         │
├────────────────────────────────┤
│      segmentLength <4 byte>    │
├────────────────────────────────┤
│      markerIndex <2 byte>      │-> what is the byte index from which the corresponding marker (key) string starts in the markerArray
└────────────────────────────────┘
```
* **marker 1..N**: marker array where the object keys are concatenated in the order of the typeDefinitions
* **nullable bitVector**: states which elements can be nulls _only in case of nullableObject container type_

# Installation

```sh
npm i @fairdatasociety/beeson --save
```

# Usage

The library can be used in Node.js and in browser environment as well.

Typescript definitions are shipped with the package.

## Build

You can build the project with the command

```sh
npm run compile && npm run compile:types
```

This compiled JS files and declarations will be placed in the `dist` folder of the project.

## Exported Functions and Classes

You can import the followings directly from `@fairdatasociety/beeson`:

* Type          # enum for [types](#Types) used in BeeSon
* BeeSon        # BeeSon class that you can initialize with either JSON object or AbiManager
* AbiManager    # AbiManager class that defines JSON object structures/types and its ABI

Work with non-container types:
```js
{ BeeSon, AbiManager } = require('@fairdatasociety/beeson')

// initialize BeeSon object
beeSon1 = new BeeSon({ json: 123 })
// override its value
beeSon1.json = 456
// get its json value
console.log(beeSon1.json)
// it does not allow to override with value outside its defined type
beeSon1.json = 456.789 //throws AssertJsonValueError: Wrong value for type number (integer)...
beeSon1.json = 'john doe' //throws error as well
// get JSON description of the ABI
abiJson = beeSon1.abiManager.getAbiObject()
// initialize AbiManager with this ABI JSON description
abiManager = AbiManager.loadAbiObject(abiJson)
// initialize new BeeSon object with the same ABI that beeSon1 has
beeSon2 = new BeeSon({ abiManager })
// set number value for beeSon2
beeSon2.json = 789
// serialize beeSon object
beeSon2Bytes = beeSon2.serialize()
// deserialize beeSon2 byte array
beeSon2Again = BeeSon.deserialize(beeSon2Bytes)
// check its value and type
console.log(beeSon2Again.json) // 789
console.log(beeSon2Again.abiManager.type) // 29
```

The same actions can be done with container types, but it also can handle nulls on its element types:
```js
{ BeeSon, AbiManager } = require('@fairdatasociety/beeson')

json = {
    name: 'john coke',
    age: 48,
    id: 'ID2',
    buddies: [{ name: 'jesus', age: 33, id: 'ID1' }],
}
// initialize BeeSon object
beeSon1 = new BeeSon({ json })
// change JSON object
json.id = 'ID3'
json.buddies[0].name = 'buddha'
beeSon1.json = json
// print type
console.log(beeSon1.abiManager.type) // 64
// try to set ID null
json.id = null
beeSon1.json = json // throws error
// transform abi definition from strictObject to nullableObject
nullableAbi = beeSon1.abiManager.getNullableContainerAbiManager()
beeSon2 = new BeeSon({ abiManager: nullableAbi })
beeSon2.json = json // does not throw error
```
