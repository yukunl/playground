// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTheme, readTheme, THEME_KEY, useTheme } from '../../src/client/theme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('theme', () => {
  it('cycles System → Light → Dark → System', () => {
    expect(nextTheme('system')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('system')
  })

  it('treats a missing or unknown saved value as System', () => {
    expect(readTheme()).toBe('system')
    localStorage.setItem(THEME_KEY, 'sepia')
    expect(readTheme()).toBe('system')
  })

  it('puts the dark class on <html> and remembers the choice', () => {
    const { result } = renderHook(() => useTheme())
    act(() => result.current[1]('dark'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')

    act(() => result.current[1]('light'))
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    act(() => result.current[1]('system'))
    expect(localStorage.getItem(THEME_KEY)).toBeNull()
  })
})
