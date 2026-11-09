// Loads one module file from ../js the way the built page does (all modules share one IIFE scope).
// usage: const NAV = require('./load')('nav.js', 'NAV');            // standalone module
//        const CAMPUS = require('./load')('campus.js', 'CAMPUS', {LAYOUT}); // pass modules it may reference
const fs = require('fs'), path = require('path');
module.exports = function load(file, name, deps) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
  const names = Object.keys(deps || {});
  return new Function(...names, '"use strict";\n' + src + '\n;return ' + name + ';')(...names.map(n => deps[n]));
};
