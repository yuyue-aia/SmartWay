const CHILDREN = [
  { id: 'yuxiao', name: '余晓' },
  { id: 'yuyue', name: '余跃' }
];

const CHILD_IDS = new Set(CHILDREN.map(child => child.id));

function isValidChildId(childId) {
  return CHILD_IDS.has(childId);
}

module.exports = {
  CHILDREN,
  CHILD_IDS,
  isValidChildId
};
