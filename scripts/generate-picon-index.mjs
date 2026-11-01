/**
 * generate-picon-index.mjs
 * 
 * Génère un index des picons disponibles sur tv-logo/tv-logos
 * en utilisant l'API GitHub Tree pour éviter les requêtes HEAD.
 * 
 * Usage: node scripts/generate-picon-index.mjs
 */

const GITHUB_API = 'https://api.github.com/repos/tv-logo/tv-logos/git/trees/main?recursive=1';
const OUTPUT_PATH = './src/data/picon-index.json';

async function fetchPiconTree() {
  console.log('📡 Fetching picon tree from GitHub API...');
  
  const response = await fetch(GITHUB_API, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'NyxPlayer-PiconIndexer'
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  console.log(`✅ Received ${data.tree.length} items from GitHub`);
  
  return data.tree;
}

function normalizeName(filename) {
  // Enlever l'extension et normaliser
  return filename
    .replace(/\.png$/i, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // Supprimer accents
}

function extractPiconIndex(tree) {
  console.log('🔍 Extracting PNG files from countries directory...');
  
  const picons = new Set();
  
  for (const item of tree) {
    // On ne garde que les fichiers PNG dans countries/
    if (item.type === 'blob' && 
        item.path.startsWith('countries/') && 
        item.path.endsWith('.png')) {
      
      // Extraire le nom de fichier
      const parts = item.path.split('/');
      const filename = parts[parts.length - 1];
      const normalized = normalizeName(filename);
      
      picons.add(normalized);
    }
  }
  
  console.log(`📊 Found ${picons.size} unique picon names`);
  return Array.from(picons).sort();
}

async function main() {
  try {
    const tree = await fetchPiconTree();
    const index = extractPiconIndex(tree);
    
    // Écrire le fichier JSON
    const fs = await import('fs/promises');
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(index, null, 0));
    
    const stats = await fs.stat(OUTPUT_PATH);
    console.log(`💾 Saved to ${OUTPUT_PATH} (${(stats.size / 1024).toFixed(1)} KB)`);
    console.log('✨ Done!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
