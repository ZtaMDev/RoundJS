/**
 * Computes line start offsets for a given source string.
 * @param {string} source
 * @returns {number[]} Array of offsets where each line starts.
 */
function computeLineStarts(source) {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      lineStarts.push(i + 1);
    }
  }
  return lineStarts;
}

/**
 * Converts a 0-based offset to line and column (1-based).
 * @param {number} offset
 * @param {number[]} lineStarts
 * @returns {{line: number, column: number}}
 */
function offsetToPos(offset, lineStarts) {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (lineStarts[mid] <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const lineIndex = high; // 0-based
  const lineStart = lineStarts[lineIndex];
  
  return {
    line: lineIndex + 1,
    column: offset - lineStart + 1
  };
}

/**
 * Remaps ESLint messages to original source positions.
 * @param {any[]} messages
 * @param {{source: string, mapper: any}} state
 * @returns {any[]}
 */
export function remapMessages(messages, state) {
  const { source, mapper } = state;
  const lineStarts = computeLineStarts(source);

  return messages.map(msg => {
    if (!msg.range && !msg.line) return msg;

    let startOffset, endOffset;
    
    if (msg.range) {
        startOffset = msg.range[0];
        endOffset = msg.range[1];
    } else {
       return msg;
    }

    // Remap offsets using SourceMapper
    const originalStart = mapper.remap(startOffset);
    const originalEnd = mapper.remap(endOffset);

    // Calculate new line/column
    const startPos = offsetToPos(originalStart, lineStarts);
    const endPos = offsetToPos(originalEnd, lineStarts);

    // Clone and update message
    return {
      ...msg,
      line: startPos.line,
      column: startPos.column,
      endLine: endPos.line,
      endColumn: endPos.column,
      range: [originalStart, originalEnd],
      fix: undefined
    };
  });
}
