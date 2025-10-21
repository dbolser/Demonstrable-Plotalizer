# Interactive Scatter Plot Matrix

A high-performance, interactive scatter plot matrix visualization tool built
with React, TypeScript, and D3.js. Optimized for large datasets (30k+ rows, 30+
columns) with advanced features like drag-and-drop column reordering,
intelligent filtering, and real-time brushing.

https://dbolser.github.io/Demonstrable-Plotalizer/

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
