# Interactive Scatter Plot Matrix

A high-performance, interactive scatter plot matrix visualization tool built
with React, TypeScript, and D3.js. Optimized for large datasets (30k+ rows, 30+
columns) with advanced features like drag-and-drop column reordering,
intelligent filtering, and real-time brushing.

https://dbolser.github.io/Demonstrable-Plotalizer/

## Features

- 🚀 **High Performance**: Canvas rendering with Web Worker CSV parsing, RAF time-sliced rendering (the UI never freezes on big files), and a per-cell ImageData LRU cache so toggling a setting back restores instantly. See [ROADMAP.md](ROADMAP.md) for the performance targets and scaling plan.
- 📁 **Flexible Data Loading**:
  - Drag-and-drop or click-to-upload CSV / TSV files (`.csv`, `.tsv`, `.tab`, `.txt`)
  - Load directly from a URL via the input field or a `?data=<url>` query param
  - Recent files remembered in IndexedDB for one-click reloading
  - Empty columns are detected and reported rather than silently dropped
- 🎯 **Interactive Selection**:
  - Rubber-band selection in scatter plots
  - Horizontal/vertical range selection in histograms
  - Selected points highlighted in blue across all plots
  - Toggle between **Highlight** (dim others) and **Filter** (hide others) modes
  - Clear selection with ESC key or ✕ button
- 🌈 **Color-By**: Color points by a category column, by file order (rainbow gradient — a quick "is this file sorted?" detector), or by any column's rank via a click on its diagonal label
- 📊 **Histograms**: Optional histograms on the matrix diagonal, with color-stacked bars when color-by is active
- 📈 **Reference Lines**: Per-cell x=y identity line and least-squares regression line with r², fit in transformed space on log axes
- 🧮 **PCA**: One click computes principal components over the visible columns and appends PC1–PC3 as derived columns, with explained-variance readout
- 🔎 **Fluid Zoom**: Ctrl/Cmd+wheel zooms the matrix smoothly (plus +/− buttons and keys), re-rendering once on commit
- 📋 **Data Table**: Toggleable table of all rows (or just the current selection) below the matrix, with a drag-resizable divider
- 🔄 **Column Management**: Drag-and-drop reordering, name-pattern filtering (e.g., "mac1", "n_snps"), visibility toggles, and automatic prefix-based grouping
- 🎨 **Multiple Scales**: Linear and logarithmic scaling per column, or a global log toggle
- 💾 **SVG Export**: Download the current matrix as an SVG file
- 🏷️ **Build Version**: The deployed build's version string is shown in the header


## Quick Start

**Prerequisites:** Node.js

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **(Optional) Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` to add your settings:
   - `VITE_ALLOWED_HOSTS` - Comma-separated list of allowed preview server hosts (e.g., `myserver.lan,192.168.1.33`)

3. **Run the development server:**
   ```bash
   npm run dev
   ```

4. **Open your browser to:**
   ```
   http://localhost:3000
   ```
   Or access from other machines on your network (e.g., `http://192.168.1.33:3000`)


## Production

### Build for Production

```bash
npm run build
```

### Preview Production Build
```bash
npm run preview
```

### Deploy to GitHub Pages

This project is configured to automatically deploy to GitHub Pages when you push to the `main` branch.

**Setup Steps:**

1. **Enable GitHub Pages in your repository:**
   - Go to your repository on GitHub
   - Navigate to **Settings** → **Pages**
   - Under "Build and deployment" → "Source", select **GitHub Actions**

2. **Push your code to GitHub:**
   ```bash
   git add .
   git commit -m "Add GitHub Pages deployment"
   git push origin main
   ```

3. **Monitor the deployment:**
   - Go to the **Actions** tab in your GitHub repository
   - Watch the "Deploy to GitHub Pages" workflow run
   - Once complete, your site will be live at: `https://yourusername.github.io/Demonstrable-Plotalizer/`

**Manual Deployment:**
You can also trigger a deployment manually from the Actions tab by clicking "Run workflow".


## Project Structure

### Static Assets
- `public/` - Static files that are copied as-is during build (e.g., `public/data/sample.csv`)
- Static assets in `public/` are served from the root URL in development and production

### Development

### Running Tests
```bash
# Run all tests once
npm run test:run

# Run tests in watch mode
npm test

# Run tests with test UI
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
