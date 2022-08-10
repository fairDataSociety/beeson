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

| Type | Value | Binary | JSON Type |
| ---- | ---- | ------- | ----------- |
| null | 1 | 00000000 00000001 | null |
| boolean | 2 | 00000000 00000010 | boolean |
| float32 | 4 | 00000000 00000100 | number |
| float64 | 5 | 00000000 00000101 | number |
| string | 8 | 00000000 00001000 | string |
| uint8 | 64 | 00000000 01000000 | number |
| int8 | 65 | 00000000 01000001 | number |
| int16 | 97 | 00000000 01100001 | number |
| int32 | 113 | 00000000 01110001 | number |
| int64 | 121 | 00000000 01111001 | number |
| superBeeSon | 4096 | 00010000 00000000 | container type |
| array | 8192 | 00100000 00000000 | array |
| nullableArray | 8448 | 00100001 00000000 | array  |
| object | 16384 | 01000000 00000000 | object |
| nullableObject | 16640 | 01000001 00000000 | object  |
| swarmCac | 32768 | 10000000 00000000 | string |
| swarmSoc | 33024 | 10000001 00000000 | string |

The library defaults the JSON types to the followings:
* `number` (when it does not have decimal value): `int32`
* `number` (when it does have decimal value): `float32`

The `superBeeSon` type is a notation for a container type data implementation (e.g. array or object) where the type specification is referenced with a Swarm hash.
This reserves only 2 segments before the data implementation so that the on-chain identification of the data-blob cannot be cheaper.

The `swarmCac` and `swarmSoc` are misc types that are deserialized as regexed strings according to the rules of [Swarm CIDs](https://github.com/ethersphere/swarm-cid-js/). Additionally, the serialization can interpret the CID object used in `swarm-cid-js`.

Of course, these defaults can be overridden by using the library's TypeScpecification manager.

The type serialization is 2 bytes, but it is extensible until 28 bytes.


# Marshalling

## BeeSon header

Every BeeSon has to start with a serialised header that consists of
```
┌────────────────────────────────┐
│      versionBytes <4 byte>     │
├────────────────────────────────┤
│      blobFlags <28 byte>       │
└────────────────────────────────┘
```
- `versionBytes`: the first byte is the data-structure type, for BeeSon this is `1` and the last 3 bytes represent the [semVer](https://semver.org/)
- `blobFlags`: in BeeSon, its last 2 bytes are equal to the [Type](#Type) (similarly as in `typeDefinition`)

## Main structure

```
┌────────────────────────────────┐
│         Header <32 byte>       │
├────────────────────────────────┤
│       (TypeScpecification)     │
├────────────────────────────────┤
│       Data Implementation      │
└────────────────────────────────┘
```

All sections are padded to fit segments (32 bytes), where
- Header is always present at BeeSon types
- TypeScpecification is presented at _container types_ and sometimes at _misc types_. In other cases, it is omitted.
- Data implementation is the serialized data itself that only stores the value of the data described in the header (and in the TypeScpecification).

The elements of the TypeScpecification (abiSegmentSize, typeDefinition array, etc.) are packed, but the whole TypeScpecification byte serialization is padded to a whole segment.
It is needed, because the data implementation part can start on a new segment which is required for cheap BMT inclusion proofs.
Also, if the TypeScpecification is processed the Data Implementation has random access to its elements.

The data implementation also consists of segments where the data type can reserve one or more segments. 
If the data is smaller than a segment (32 bytes) than the data will be padded with zeros for the whole segment.

## Container types

The _arrays_ and _objects_ are container types which can include multiple elements.

In order to describe these elements, it is required to describe where these can be find in the data implementation and how to interpret those.

Its TypeScpecification describes this interpreation which's structure is stated below by types

### Array

A BeeSon array can be a _strict array_ or a _nullable array_. 
The former one requires every element to be set and cannot take `null` value.
The latter allows to define `null` values at elements which's indices present in the nullable bitVector.

The TypeScpecification structure looks like the following (including with the data implementation part for the better understanding)

```
┌────────────────────────────────┐┐
│       typeDefSize <2 byte>     ││ -> N
├────────────────────────────────┤│
│     superTypeRefSize <2 byte>  ││ -> M
├────────────────────────────────┤│
│ ┌────────────────────────────┐ ││
│ │         typeDef 1          │ ││
│ ├────────────────────────────┤ ││
│ │            ...             │ ││
│ ├────────────────────────────┤ ││
│ │         typeDef N          │ ││
│ └────────────────────────────┘ ││
│ ┌────────────────────────────┐ ││
│ │    (nullable bitVector)    │ ││
│ └────────────────────────────┘ || -> segmentPadded here
│ ┌────────────────────────────┐ ││
│ │       superTypeRef 1       │ ││
│ ├────────────────────────────┤ ││
│ │            ...             │ ││
│ ├────────────────────────────┤ ││
│ │       superTypeRef M       │ ││
│ └────────────────────────────┘ |┘
│ ┌────────────────────────────┐ │┐
│ │        dataSegment 1       │ ││
│ ├────────────────────────────┤ ││
│ │            ...             │ ││
│ ├────────────────────────────┤ ││-> Data implementation 
│ │        dataSegment L       │ ││
│ └────────────────────────────┘ ││
└────────────────────────────────┘┘
```
* **typeDefintionsSize**: tells how many elements `typeDefiniton array` has (value * 6 bytes long)
* **superTypeRefSize**: indicates the length of `superTypeRef array` as well as how many superBeeSon is defined in the `typeDefintion array`
* **typeDefinition 1..N**: typeDefinition array consist of 6 bytes elements that represents
```
┌────────────────────────────────┐
│          type <2 byte>         │-> data type of the element that has the same value set like header types
├────────────────────────────────┤
│      segmentLength <4 byte>    │-> how many segments the data implementation reserves
└────────────────────────────────┘
```
* **nullable bitVector**: states which elements can be nulls _only in case of nullableObject container type_. it is padded to a whole segment so that segment fitting type specification elements can follow.
* **superTypeRef M**: segment fitted elements that refer typeSpecifications for the described type of SuperBeeSon data.
* **dataSegment 1..L**: data implementation part where every data element reserves one or more segments (32 bytes)

### Object

A BeeSon object can be a _strict object_ or a _nullable object_.

In the TypeScpecification, the keys have an order that the corresponding typeDefinition position defines.
It prevents a JSON with the same schema (TypeScpecification) could be serialized in different ways.

The TypeScpecification serialization looks really similar to the [array's TypeScpecification](#Array)

```
┌────────────────────────────────┐┐
│       typeDefSize <2 byte>     ││ -> N
├────────────────────────────────┤│
│     superTypeRefSize <2 byte>  ││ -> M
├────────────────────────────────┤│
│      markersLength <2 byte>    ││
├────────────────────────────────┤│
│ ┌────────────────────────────┐ ││
│ │         typeDef 1          │ ││
│ ├────────────────────────────┤ ││
│ │            ...             │ ││
│ ├────────────────────────────┤ ││
│ │         typeDef N          │ ││
│ └────────────────────────────┘ ││
│ ┌────────────────────────────┐ ││
│ │          marker 1          │ ││
│ ├────────────────────────────┤ ││
│ │            ...             │ ││
│ ├────────────────────────────┤ ││
│ │          marker N          │ ││
│ └────────────────────────────┘ ││
│ ┌────────────────────────────┐ ││
│ │    (nullable bitVector)    │ ││
│ └────────────────────────────┘ │| -> segmentPadded here
│ ┌────────────────────────────┐ ││
│ │       superTypeRef 1       │ ││
│ ├────────────────────────────┤ ││
│ │            ...             │ ││
│ ├────────────────────────────┤ ││
│ │       superTypeRef M       │ ││
│ └────────────────────────────┘ |┘
│ ┌────────────────────────────┐ │┐
│ │        dataSegment 1       │ ││
│ ├────────────────────────────┤ ││
│ │            ...             │ ││
│ ├────────────────────────────┤ ││-> Data implementation 
│ │        dataSegment L       │ ││
│ └────────────────────────────┘ ││
└────────────────────────────────┘┘
```
and the differences are:
* **markersLength**: states the markers byte length in the TypeScpecification _only in case of nullableObject container type_
* **typeDef 1..N**: typeDefinition array consist of 8 bytes elements that represents
```
┌────────────────────────────────┐
│          type <2 byte>         │
├────────────────────────────────┤
│      segmentLength <4 byte>    │
├────────────────────────────────┤
│      markerIndex <2 byte>      │-> what is the byte index from which the corresponding marker (key) string starts in the markerArray
└────────────────────────────────┘
```
* **marker 1..N + M**: marker array where the object keys are concatenated in the order of the typeDefinitions

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
* TypeSpecification    # TypeSpecification class that defines JSON object structures/types and its TypeScpecification

Work with non-container types:
```js
{ BeeSon, TypeSpecification } = require('@fairdatasociety/beeson')

// initialize BeeSon object
beeSon1 = new BeeSon({ json: 123 })
// override its value
beeSon1.json = 456
// get its json value
console.log(beeSon1.json)
// it does not allow to override with value outside its defined type
beeSon1.json = 456.789 //throws AssertJsonValueError: Wrong value for type number (integer)...
beeSon1.json = 'john doe' //throws error as well
// get JSON description of the TypeScpecification
typeSpecificaitonJson = beeSon1.typeSpecificationManager.getDnaObject()
// initialize TypeSpecification with this TypeScpecification JSON description
typeSpecificationManager = TypeSpecification.loadDnaObject(typeSpecificaitonJson)
// initialize new BeeSon object with the same TypeScpecification that beeSon1 has
beeSon2 = new BeeSon({ typeSpecificationManager })
// set number value for beeSon2
beeSon2.json = 789
// serialize beeSon object
beeSon2Bytes = beeSon2.serialize()
// deserialize beeSon2 byte array
beeSon2Again = await BeeSon.deserialize(beeSon2Bytes)
// check its value and type
console.log(beeSon2Again.json) // 789
console.log(beeSon2Again.typeSpecificationManager.type)
```

The same actions can be done with container types, but it also can handle nulls on its element types:
```js
{ BeeSon } = require('@fairdatasociety/beeson')

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
console.log(beeSon1.typeSpecificationManager.type)
// try to set ID null
json.id = null
beeSon1.json = json // throws error
// transform TypeSpecification definition from strictObject to nullableObject
nullableTypeSpecification = beeSon1.typeSpecificationManager.getNullableTypeSpecification()
beeSon2 = new BeeSon({ typeSpecificationManager: nullableTypeSpecification })
beeSon2.json = json // does not throw error
```
