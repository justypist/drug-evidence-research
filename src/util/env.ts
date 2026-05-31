type Converter<T> = (v: string) => T

function _e<T = string>(name: string, defaultValue?: T, converter?: Converter<T>): T {
  const v = process.env[name]
  if (v === undefined || v === null || v.trim() === "") {
    if (defaultValue !== undefined) {
      return defaultValue
    }
    return "" as T
  }
  if (converter) {
    return converter(v)
  }
  return v as T
}

_e.required = <T = string>(name: string, converter?: Converter<T>): T => {
  const v = process.env[name]
  if (v === undefined || v === null || v.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  if (converter) {
    return converter(v)
  }
  return v as T
}

_e.number = Number
_e.bool = (v: string) => v === "true" || v === "1" || v === "yes"
_e.json = <T = unknown>(v: string) => JSON.parse(v) as T

export const e = _e