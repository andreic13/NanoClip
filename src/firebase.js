import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import {
    getDatabase,
    ref,
    set,
    onValue,
    push,
    child,
    update,
    remove,
    onDisconnect
} from "firebase/database"; // Import all needed Realtime Database functions

const firebaseConfig = {
    apiKey: "AIzaSyAkgmhsU2NcpZKFnQ9rqCQfoxBVuNkrRZA",
    authDomain: "nanoclip-f3654.firebaseapp.com",
    projectId: "nanoclip-f3654",
    storageBucket: "nanoclip-f3654.firebasestorage.app",
    messagingSenderId: "366320674093",
    appId: "1:366320674093:web:000523d534bba2ec7adfa4",
    measurementId: "G-4MCJ9NJR1P"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore (database)
export const db = getFirestore(app);

// Initialize Firebase Authentication and get a reference to the service
export const auth = getAuth(app);

// Initialize Firebase Realtime Database with the correct region URL
export const database = getDatabase(app, "https://nanoclip-f3654-default-rtdb.europe-west1.firebasedatabase.app");

// Export all needed Realtime Database functions
export { ref, set, onValue, push, child, update, remove, onDisconnect };