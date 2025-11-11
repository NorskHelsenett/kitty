/**
 * Advanced Calculator Plugin - External Code Example
 * 
 * This demonstrates a more complex plugin maintained as a separate JS file
 * that can be built with npm/bun and referenced from the plugin manifest.
 */

export const tools = [
  {
    name: 'advanced_calculate',
    description: 'Advanced mathematical calculations with support for functions like sin, cos, sqrt, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'Mathematical expression (supports: +, -, *, /, **, %, sqrt, sin, cos, tan, log, ln, abs, ceil, floor, round, pi, e)'
        }
      },
      required: ['expression']
    },
    execute: async (params) => {
      try {
        // Security: whitelist allowed functions and constants
        const allowedFunctions = {
          sqrt: Math.sqrt,
          sin: Math.sin,
          cos: Math.cos,
          tan: Math.tan,
          log: Math.log10,
          ln: Math.log,
          abs: Math.abs,
          ceil: Math.ceil,
          floor: Math.floor,
          round: Math.round,
          pi: Math.PI,
          e: Math.E,
          pow: Math.pow,
          max: Math.max,
          min: Math.min,
        };

        // Create safe evaluation context
        let expr = params.expression.toLowerCase();
        
        // Replace constants
        expr = expr.replace(/\bpi\b/g, String(Math.PI));
        expr = expr.replace(/\be\b/g, String(Math.E));
        
        // Basic validation
        if (!/^[0-9+\-*/.(),\s]+$/.test(expr.replace(/sqrt|sin|cos|tan|log|ln|abs|ceil|floor|round|pow|max|min/g, ''))) {
          return 'Error: Expression contains invalid characters';
        }

        // For a production plugin, you'd use a proper math parser like math.js
        // This is a simplified version for demonstration
        const result = eval(expr);
        
        if (result === Infinity || result === -Infinity) {
          return 'Error: Result is infinity';
        }
        if (isNaN(result)) {
          return 'Error: Result is not a number';
        }
        
        return `${params.expression} = ${result}`;
      } catch (error) {
        return `Error: ${error.message}`;
      }
    }
  },
  {
    name: 'statistics',
    description: 'Calculate statistics (mean, median, mode, standard deviation) for a set of numbers',
    inputSchema: {
      type: 'object',
      properties: {
        numbers: {
          type: 'array',
          items: { type: 'number' },
          description: 'Array of numbers to analyze'
        },
        operation: {
          type: 'string',
          enum: ['mean', 'median', 'mode', 'stddev', 'all'],
          description: 'Statistical operation to perform'
        }
      },
      required: ['numbers', 'operation']
    },
    execute: async (params) => {
      try {
        const nums = params.numbers.sort((a, b) => a - b);
        const n = nums.length;
        
        if (n === 0) {
          return 'Error: No numbers provided';
        }

        const calculateMean = () => {
          return nums.reduce((a, b) => a + b, 0) / n;
        };

        const calculateMedian = () => {
          const mid = Math.floor(n / 2);
          return n % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
        };

        const calculateMode = () => {
          const frequency = {};
          let maxFreq = 0;
          let modes = [];
          
          nums.forEach(num => {
            frequency[num] = (frequency[num] || 0) + 1;
            if (frequency[num] > maxFreq) {
              maxFreq = frequency[num];
              modes = [num];
            } else if (frequency[num] === maxFreq && !modes.includes(num)) {
              modes.push(num);
            }
          });
          
          return modes.length === n ? 'No mode' : modes.join(', ');
        };

        const calculateStdDev = () => {
          const mean = calculateMean();
          const squaredDiffs = nums.map(x => Math.pow(x - mean, 2));
          const variance = squaredDiffs.reduce((a, b) => a + b, 0) / n;
          return Math.sqrt(variance);
        };

        switch (params.operation) {
          case 'mean':
            return `Mean: ${calculateMean()}`;
          case 'median':
            return `Median: ${calculateMedian()}`;
          case 'mode':
            return `Mode: ${calculateMode()}`;
          case 'stddev':
            return `Standard Deviation: ${calculateStdDev()}`;
          case 'all':
            return JSON.stringify({
              count: n,
              mean: calculateMean(),
              median: calculateMedian(),
              mode: calculateMode(),
              stddev: calculateStdDev(),
              min: nums[0],
              max: nums[n - 1]
            }, null, 2);
          default:
            return 'Error: Invalid operation';
        }
      } catch (error) {
        return `Error: ${error.message}`;
      }
    }
  },
  {
    name: 'matrix_operations',
    description: 'Perform basic matrix operations (add, multiply, transpose, determinant)',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['add', 'multiply', 'transpose', 'determinant'],
          description: 'Matrix operation to perform'
        },
        matrix1: {
          type: 'array',
          description: 'First matrix (2D array)'
        },
        matrix2: {
          type: 'array',
          description: 'Second matrix (2D array, not needed for transpose/determinant)'
        }
      },
      required: ['operation', 'matrix1']
    },
    execute: async (params) => {
      try {
        const m1 = params.matrix1;
        const m2 = params.matrix2;

        const transpose = (matrix) => {
          return matrix[0].map((_, colIndex) => matrix.map(row => row[colIndex]));
        };

        const determinant2x2 = (matrix) => {
          if (matrix.length !== 2 || matrix[0].length !== 2) {
            throw new Error('Only 2x2 matrices supported for determinant');
          }
          return matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
        };

        switch (params.operation) {
          case 'transpose':
            return JSON.stringify(transpose(m1), null, 2);
          
          case 'determinant':
            return `Determinant: ${determinant2x2(m1)}`;
          
          case 'add':
            if (!m2 || m1.length !== m2.length || m1[0].length !== m2[0].length) {
              return 'Error: Matrices must have same dimensions for addition';
            }
            const sum = m1.map((row, i) => row.map((val, j) => val + m2[i][j]));
            return JSON.stringify(sum, null, 2);
          
          case 'multiply':
            if (!m2 || m1[0].length !== m2.length) {
              return 'Error: Invalid dimensions for matrix multiplication';
            }
            const result = m1.map(row =>
              transpose(m2).map(col =>
                row.reduce((sum, val, i) => sum + val * col[i], 0)
              )
            );
            return JSON.stringify(result, null, 2);
          
          default:
            return 'Error: Invalid operation';
        }
      } catch (error) {
        return `Error: ${error.message}`;
      }
    }
  }
];
