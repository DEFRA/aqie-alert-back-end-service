import { describe, it, expect } from 'vitest'
import {
  MAGIC_NO_FIVE,
  MAGIC_NO_201,
  MINUS_FOUR,
  USER_NOT_FOUND_STATUS_CODE,
  STATUS_OK,
  INTERNAL_SERVER_ERROR,
  DB_ERROR_CODE,
  DAQI_VERY_HIGH_THRESHOLD
} from './constants.js'

describe('constants', () => {
  it('MAGIC_NO_FIVE is 5', () => expect(MAGIC_NO_FIVE).toBe(5))
  it('MAGIC_NO_201 is 201', () => expect(MAGIC_NO_201).toBe(201))
  it('MINUS_FOUR is -4', () => expect(MINUS_FOUR).toBe(-4))
  it('USER_NOT_FOUND_STATUS_CODE is 404', () =>
    expect(USER_NOT_FOUND_STATUS_CODE).toBe(404))
  it('STATUS_OK is 200', () => expect(STATUS_OK).toBe(200))
  it('INTERNAL_SERVER_ERROR is 500', () =>
    expect(INTERNAL_SERVER_ERROR).toBe(500))
  it('DB_ERROR_CODE is 11000', () => expect(DB_ERROR_CODE).toBe(11000))
  it('DAQI_VERY_HIGH_THRESHOLD is 10', () =>
    expect(DAQI_VERY_HIGH_THRESHOLD).toBe(10))
})
