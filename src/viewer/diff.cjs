const MAX_LCS_CELLS = 240000

function createLineDiff(before = '', after = '') {
  const left = splitLines(before)
  const right = splitLines(after)
  const lines = left.length * right.length <= MAX_LCS_CELLS
    ? lcsDiff(left, right)
    : fallbackDiff(left, right)
  return {
    lines,
    stats: {
      added: lines.filter(line => line.type === 'add').length,
      removed: lines.filter(line => line.type === 'remove').length
    }
  }
}

function splitLines(value) {
  if (!value) return []
  return String(value).replace(/\r\n/g, '\n').split('\n')
}

function lcsDiff(left, right) {
  const rows = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1))
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      rows[i][j] = left[i] === right[j]
        ? rows[i + 1][j + 1] + 1
        : Math.max(rows[i + 1][j], rows[i][j + 1])
    }
  }
  const result = []
  let i = 0
  let j = 0
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      result.push({ type: 'equal', text: left[i] })
      i += 1
      j += 1
    } else if (j < right.length && (i >= left.length || rows[i][j + 1] >= rows[i + 1][j])) {
      result.push({ type: 'add', text: right[j] })
      j += 1
    } else {
      result.push({ type: 'remove', text: left[i] })
      i += 1
    }
  }
  return result
}

function fallbackDiff(left, right) {
  let prefix = 0
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < left.length - prefix
    && suffix < right.length - prefix
    && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    suffix += 1
  }
  return [
    ...left.slice(0, prefix).map(text => ({ type: 'equal', text })),
    ...left.slice(prefix, left.length - suffix).map(text => ({ type: 'remove', text })),
    ...right.slice(prefix, right.length - suffix).map(text => ({ type: 'add', text })),
    ...left.slice(left.length - suffix).map(text => ({ type: 'equal', text }))
  ]
}

module.exports = { createLineDiff }
