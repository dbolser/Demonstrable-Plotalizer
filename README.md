# Interactive Scatter Plot Matrix

A high-performance, interactive scatter plot matrix visualization tool built with React, TypeScript, and D3.js. Optimized for large datasets (30k+ rows, 30+ columns) with advanced features like drag-and-drop column reordering, intelligent filtering, and real-time brushing.

## Features

- 🚀 **High Performance**: Handles 30k+ data points with canvas rendering and intelligent caching
- 🎯 **Interactive Selection**: 
  - Rubber-band selection in scatter plots
  - Horizontal/vertical range selection in histograms
  - Selected points highlighted in blue across all plots
  - Toggle between **Highlight** (dim others) and **Filter** (hide others) modes
  - Clear selection with ESC key or ✕ button
- 🔄 **Drag & Drop**: Reorder columns with smooth performance optimization
- 🔍 **Smart Filtering**: Filter columns by name patterns (e.g., "mac1", "n_snps")
- 📊 **Histograms**: Optional histogram display on matrix borders with partial selection coloring
- 🎨 **Multiple Scales**: Linear and logarithmic scaling options per column
- 📁 **CSV Import**: Drag and drop CSV files or load sample data


## Quick Start

**Prerequisites:** Node.js

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run the development server:**
   ```bash
   npm run dev
   ```

3. **Open your browser to:**
   ```
   http://localhost:3000
   ```

## Development

### Build for Production
```bash
npm run build
```

### Preview Production Build
```bash
npm run preview
```

### Running Tests
```bash
# Run all tests once
npm run test:run

# Run tests in watch mode
npm test

# Run tests with UI (open a fancy GUI to show test results)
npm run test:ui

# Run with coverage
npm run test:coverage
```

### Test Coverage
- ✅ **27 passing tests**
- 🧪 **Unit Tests**: Column reordering, filtering, selection logic
- ⚡ **Performance Tests**: Large dataset benchmarks
- 🏗️ **Component Tests**: React integration logic
- 🎯 **Selection Tests**: Spatial grid, cache stability, brush integration

See [TESTING.md](TESTING.md) for detailed testing information.
