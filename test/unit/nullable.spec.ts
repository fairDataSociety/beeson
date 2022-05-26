import { AbiManager, BeeSon, Type } from '../../src'
import { Bytes } from '../../src/utils'

interface TestBuddy {
  name: string
  age: number
  id: string
}
interface TestDataMain extends TestBuddy {
  buddies: TestBuddy[]
}

describe('nullable operations on beeson', () => {
  it('should create nullable containers from strict ones', () => {
    const json: TestDataMain = {
      name: 'john coke',
      age: 48,
      id: 'ID2',
      buddies: [{ name: 'jesus', age: 33, id: 'ID1' }],
    }
    const beeson = new BeeSon<TestDataMain>({ json })
    expect(beeson.abiManager.type).toBe(Type.object)
    const nullableBeeSon = beeson.getNullableContainer()
    expect(nullableBeeSon.abiManager.type).toBe(Type.nullableObject)
    const json2 = nullableBeeSon.json
    json2.age = null
    nullableBeeSon.json = json2
    expect(() => (beeson.json = json2)).toThrowError(
      'BeeSon Object assertion problem at index age: Wrong value for type number (integer). Got value has type: object. Value: null',
    )
    nullableBeeSon.setIndexNullable('name', false)
    expect(() => beeson.setIndexNullable('name', false)).toThrowError(
      /^BeeSon object is not a nullable container type/,
    )
    expect(() => nullableBeeSon.setIndexNullable('age', false)).toThrowError(
      'Wrong value for type number (integer). Got value has type: object. Value: null',
    )
    json2.age = 42
    nullableBeeSon.json = json2
    nullableBeeSon.setIndexNullable('age', false)
  })

  it('should get Abi object and init AbiManager', () => {
    const json: TestDataMain = {
      name: 'john coke',
      age: 48,
      id: 'ID2',
      buddies: [{ name: 'jesus', age: 33, id: 'ID1' }],
    }
    const beeson = new BeeSon<TestDataMain>({ json })
    const nullableBeeSon = beeson.getNullableContainer()
    nullableBeeSon.setIndexNullable('name', false)
    const abiObject = nullableBeeSon.abiManager.getAbiObject()
    const abiManager = AbiManager.loadAbiObject(abiObject, new Bytes(32))
    const beesonAgain = new BeeSon({ abiManager })
    beesonAgain.json = { name: 'valami', age: null, buddies: null, id: null }
    beesonAgain.json = json
    expect(() => (beesonAgain.json = { name: 'nvm' })).toThrowError(
      /^Given JSON object has 1 key length, when the abi defines 4 length./,
    )
    expect(() => (beesonAgain.json = { name: null, age: null, buddies: null, id: null })).toThrowError(
      'BeeSon Object assertion problem at index name: Wrong value for type string. Got value has type: object. Value: null',
    )
  })
})