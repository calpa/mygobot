const fs = require('fs');

// Read the original data
const data = JSON.parse(fs.readFileSync('./src/data.json', 'utf8'));

// Transform the data to simplified format
const simplifiedData = data.map(filename => {
  // Extract the important parts: ep01_000_小祥
  const match = filename.match(/bandori_family_(ep\d+_\d+_.+)\.(jpg|png)/);
  return match ? match[1] : filename;
});

// Write the simplified data back to a new file
fs.writeFileSync('./src/simplified-data.json', JSON.stringify(simplifiedData, null, 2));

console.log(`Transformed ${data.length} items to simplified format`);
