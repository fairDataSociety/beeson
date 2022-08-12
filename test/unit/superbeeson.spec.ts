import { makeChunkedFile } from '@fairdatasociety/bmt-js'
import { BeeSon, Type } from '../../src'
import { HEADER_BYTE_LENGTH, TypeManager } from '../../src/type-specification'
import { createStorage, SEGMENT_SIZE } from '../../src/utils'
export { Reference } from '../../src/types'

interface TestBuddy {
  name: string
  age: number
  id: string
}
interface TestDataMain extends TestBuddy {
  buddies: TestBuddy[]
}

describe('superbeeson', () => {
  /** used only for deserialization, its attributes shouldn't change */
  const json: TestDataMain = {
    name: 'john coke',
    age: 48,
    id: 'ID2',
    buddies: [{ name: 'jesus', age: 33, id: 'ID1' }],
  }

  it('should serialize object', async () => {
    const beeson = new BeeSon<TestDataMain>({ json })
    const beesonBytes = beeson.serialize()
    const beesonTypeSpecBytes = beeson.typeManager.serialize()
    expect(beeson.typeManager.type).toBe(Type.object)
    expect(beeson.superBeeSon).toBe(false)
    beeson.superBeeSon = true
    expect(beeson.typeManager.type).toBe(Type.object)
    expect(beeson.superBeeSon).toBe(true)
    const superBeesonBytes = beeson.serialize()
    // the segment size is the TypeSpecification reference
    expect(superBeesonBytes.length).toBe(
      beesonBytes.length - beesonTypeSpecBytes.length + HEADER_BYTE_LENGTH + SEGMENT_SIZE,
    )

    // check the parts of the BeeSon corresponds to its byte serialisation indices
    const typeSpecificationAddress = makeChunkedFile(beesonTypeSpecBytes).address()
    expect(typeSpecificationAddress).toStrictEqual(
      superBeesonBytes.slice(HEADER_BYTE_LENGTH, HEADER_BYTE_LENGTH + SEGMENT_SIZE),
    )
    // after the headers and typeSpecifications the payloads are matching.
    expect(superBeesonBytes.slice(HEADER_BYTE_LENGTH + SEGMENT_SIZE)).toStrictEqual(
      beesonBytes.slice(beesonTypeSpecBytes.length),
    )
  })

  it('should deserialize object', async () => {
    const storage = createStorage()
    const beeson = new BeeSon<TestDataMain>({ json })
    const beesonTypeSpecBytes = beeson.typeManager.serialize()
    const typeRef = makeChunkedFile(beesonTypeSpecBytes).address()
    storage.storageSaverSync(typeRef, beesonTypeSpecBytes)
    beeson.superBeeSon = true
    const beesonBytes = beeson.serialize()
    const beesonAgain = await BeeSon.deserialize(beesonBytes, undefined, storage.storageLoader)
    expect(beeson.superBeeSon).toBe(beesonAgain.superBeeSon)
    expect(beesonAgain.json).toStrictEqual(beeson.json)
    // not with dnaObject
    const dnaObject = beesonAgain.typeManager.getDnaObject()
    const beeSonAgain2 = new BeeSon({ typeManager: TypeManager.loadDnaObject(dnaObject) })
    beeSonAgain2.json = json
    const beesonBytesAgain = beeSonAgain2.serialize()
    expect(beesonBytesAgain).toStrictEqual(beesonBytes)
  })

  it('should serialize/deserialize superbeeson attribute', async () => {
    const storage = createStorage()
    const beeson = new BeeSon<TestDataMain>({ json })
    const beesonBytesFull = beeson.serialize()
    const typeSpecBytes = beeson.typeManager.serialize()
    const buddiesArray = beeson.typeManager.typeDefinitions.filter(t => t.marker === 'buddies')[0]
    const buddiesTypeSpecBytes = buddiesArray.beeSon.typeManager.serialize()
    const typeRef = makeChunkedFile(buddiesTypeSpecBytes).address()
    storage.storageSaverSync(typeRef, buddiesTypeSpecBytes)

    buddiesArray.beeSon.superBeeSon = true
    const superBeesonBytes = beeson.serialize()
    const superTypeSpecBytes = beeson.typeManager.serialize()
    // new typeSpecificationBytes should be bigger than the original one with the referenced abi spec.
    expect(superTypeSpecBytes.length).toBe(typeSpecBytes.length + SEGMENT_SIZE)
    // superBeeSonBytes should be greater by segment size because its arra element segments padded with zeros
    expect(superBeesonBytes.length).toBe(beesonBytesFull.length + SEGMENT_SIZE)
    const beesonAgain = await BeeSon.deserialize(superBeesonBytes, undefined, storage.storageLoader)
    expect(beesonAgain.json).toStrictEqual(beeson.json)
  })
})
