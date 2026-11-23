// ─────────────────────────────────────────────────────────────
//  Daily Desk — configuration
//  This is the file to edit when you want to change how the app
//  behaves. Most of these can also be changed in the app's
//  Settings screen; values here are only the starting defaults.
// ─────────────────────────────────────────────────────────────

// 1. SYNC (Firebase). Leave apiKey empty to run "this device only".
//    Paste the config object from Firebase → Project settings → Your apps.
//    These values are not secret; your data is protected by sign-in
//    and the rules in firestore.rules.
export const firebaseConfig = {
  apiKey: 'AIzaSyB0D0cy7IyKE1oSfErLoUYGdVniNPVFKuk',
  authDomain: 'daily-desk-77704.firebaseapp.com',
  projectId: 'daily-desk-77704',
  storageBucket: 'daily-desk-77704.firebasestorage.app',
  messagingSenderId: '967385715726',
  appId: '1:967385715726:web:1d849ec2a54729232a185f'
};

// 2. BOARD COLUMNS (order matters). The ids are stored on tasks,
//    so rename the label freely but keep the id.
export const COLUMNS = [
  { id: 'ideas', label: 'Ideas' },
  { id: 'next', label: 'Next' },
  { id: 'doing', label: 'Doing' },
  { id: 'done', label: 'Done' }
];

// 3. PRIORITIES. "Must" = blocking or time-sensitive.
export const PRIORITIES = [
  { id: 'must', label: 'Must' },
  { id: 'should', label: 'Should' },
  { id: 'could', label: 'Could' }
];

// 4. COLOURS available for categories (defined in css/app.css).
export const CATEGORY_COLOURS = ['namib', 'sage', 'ochre', 'navy', 'grey', 'plum'];

// 5. STARTING SETTINGS (only used the very first time the app opens).
export const DEFAULT_SETTINGS = {
  appearance: 'auto',           // 'auto' | 'day' | 'night'
  showIdeas: true,              // show the Ideas column on the Board
  busyMode: false,
  busyMustCount: 3,             // how many Musts Busy mode shows before "+N more"
  hideWorkOutsideHours: true,
  workHours: { days: [1, 2, 3, 4, 5], start: 9, end: 17 }, // 0 = Sunday
  habitCap: 6,
  habits: [
    { id: 'strength', name: 'Strength', core: false },
    { id: 'cardio', name: 'Cardio', core: false },
    { id: 'read', name: 'Read', core: false },
    { id: 'water', name: 'Water', core: true },
    { id: 'phone', name: 'Phone out of bed', core: false },
    { id: 'family', name: 'Family time', core: true }
  ],
  categories: [
    { id: 'home', name: 'Home', color: 'namib' },
    { id: 'health', name: 'Health', color: 'sage' },
    { id: 'ideas', name: 'Ideas', color: 'ochre' },
    { id: 'projects', name: 'Projects', color: 'navy' },
    { id: 'work', name: 'Work', color: 'grey' }
  ],
  // Calendar helper (see worker/README.md). Filled in from Settings.
  calendar: { url: '', token: '' },
  // Plain-English rules for the daily suggestions (edited in Settings)
  suggestionRules: '',
  learnedRulesRemoved: [],
  updatedAt: 0
};
