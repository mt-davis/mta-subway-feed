export const ROUTE_COLORS: Record<string, string> = {
  '1': '#EE352E',
  '2': '#EE352E',
  '3': '#EE352E',
  '4': '#00933C',
  '5': '#00933C',
  '6': '#00933C',
  '6X': '#00933C',
  '7': '#B933AD',
  '7X': '#B933AD',
  'A': '#0039A6',
  'C': '#0039A6',
  'E': '#0039A6',
  'B': '#FF6319',
  'D': '#FF6319',
  'F': '#FF6319',
  'FX': '#FF6319',
  'M': '#FF6319',
  'G': '#6CBE45',
  'J': '#996633',
  'Z': '#996633',
  'L': '#A7A9AC',
  'N': '#FCCC0A',
  'Q': '#FCCC0A',
  'R': '#FCCC0A',
  'W': '#FCCC0A',
  'S': '#808183',
  'GS': '#808183',
  'FS': '#808183',
  'H': '#0039A6',
  'SI': '#003DA5',
  'SIR': '#003DA5',
};

export const ROUTE_GROUPS = [
  { label: '1·2·3', routes: ['1', '2', '3'], color: '#EE352E' },
  { label: '4·5·6', routes: ['4', '5', '6', '6X'], color: '#00933C' },
  { label: '7', routes: ['7', '7X'], color: '#B933AD' },
  { label: 'A·C·E', routes: ['A', 'C', 'E', 'H'], color: '#0039A6' },
  { label: 'B·D·F·M', routes: ['B', 'D', 'F', 'FX', 'M'], color: '#FF6319' },
  { label: 'G', routes: ['G'], color: '#6CBE45' },
  { label: 'J·Z', routes: ['J', 'Z'], color: '#996633' },
  { label: 'L', routes: ['L'], color: '#A7A9AC' },
  { label: 'N·Q·R·W', routes: ['N', 'Q', 'R', 'W'], color: '#FCCC0A' },
  { label: 'S', routes: ['S', 'GS', 'FS'], color: '#808183' },
  { label: 'SIR', routes: ['SI', 'SIR'], color: '#003DA5' },
];

export function getRouteColor(routeId: string): string {
  return ROUTE_COLORS[routeId] ?? '#FFFFFF';
}

export function getTextColor(bgColor: string): string {
  // Return black text for light colors (yellow, light gray), white for dark
  const lightColors = ['#FCCC0A', '#A7A9AC', '#6CBE45'];
  return lightColors.includes(bgColor) ? '#000000' : '#FFFFFF';
}
