// S2's unsigned 64-bit id: 3 face bits, 2 bits per Hilbert digit,
// a 1-bit level marker, then zero padding to bit 64. Native BigInt avoids
// long.js's repeated decimal division when a new viewport visits many cells.
const quadBits=['00','01','10','11'];
export function s2KeyToId(key) {
  const [face,position]=key.split('/');
  const bits=Number(face).toString(2)+Array.from(position,digit=>quadBits[Number(digit)]).join('')+'1';
  return (BigInt('0b'+bits)<<BigInt(60-2*position.length)).toString();
}
export function s2IdToKey(id) {
  const bits=BigInt(id).toString(2).padStart(64,'0'),end=bits.lastIndexOf('1');
  const position=bits.slice(3,end);
  return parseInt(bits.slice(0,3),2)+'/'+(position?BigInt('0b'+position).toString(4).padStart(position.length/2,'0'):'');
}
