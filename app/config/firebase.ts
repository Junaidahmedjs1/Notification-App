import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Your Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDqQKdR4Of1IV8nj3JjzrRyI0PKmePEhxo",
  authDomain: "notification-app-d77ca.firebaseapp.com",
  projectId: "notification-app-d77ca",
  storageBucket: "notification-app-d77ca.appspot.com",
  messagingSenderId: "180566531143",
  appId: "1:180566531143:web:4e1977ce11d061abe82562"
};
// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Get Auth instance
export const auth = getAuth(app);

// Initialize Firestore
export const db = getFirestore(app);

// Add this to verify initialization
auth.onAuthStateChanged((user) => {
  console.log('Auth state changed:', user ? 'User is signed in' : 'No user');
});

export default app; 