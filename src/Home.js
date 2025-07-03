import { useEffect, useState } from 'react';
import { auth, db } from './firebase';
import { signOut, onAuthStateChanged } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import FriendsModal from './FriendsModal';
import {
    collection,
    addDoc,
    query,
    orderBy,
    onSnapshot,
    getDoc,
    doc,
    setDoc,
    updateDoc,
    getDocs,
    where,
    average
} from 'firebase/firestore';
import GameModal from './gameModals';
import './gameModals.css';
import './Home.css';

export default function Home() {
    const [user, setUser] = useState(null);
    const navigate = useNavigate();
    const [showGameModal, setShowGameModal] = useState(false);
    const [selectedGame, setSelectedGame] = useState(null);
    const [gamesData, setGamesData] = useState({});
    const [showFriendsModal, setShowFriendsModal] = useState(false);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                // Get user data from Firestore
                const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
                if (userDoc.exists()) {
                    setUser({
                        ...currentUser,
                        ...userDoc.data()
                    });
                } else {
                    setUser(currentUser);
                }
            } else {
                setUser(null);
            }
        });

        return () => unsubscribe();
    }, []);

    // Function to calculate ratings for a game
    const calculateGameRating = async (gameTitle) => {
        try {
            const ratingsQuery = query(collection(db, 'games', gameTitle, 'ratings'));
            const snapshot = await getDocs(ratingsQuery);

            if (!snapshot.empty) {
                let total = 0;
                let count = 0;
                snapshot.forEach(doc => {
                    const rating = doc.data().rating;
                    if (rating && !isNaN(rating)) {
                        total += rating;
                        count++;
                    }
                });

                return count > 0 ? {
                    averageRating: total / count,
                    totalRatings: count
                } : { averageRating: 0, totalRatings: 0 };
            } else {
                return { averageRating: 0, totalRatings: 0 };
            }
        } catch (error) {
            console.error(`Error calculating rating for ${gameTitle}:`, error);
            return { averageRating: 0, totalRatings: 0 };
        }
    };

    // Load ratings for all games
    useEffect(() => {
        const gamesList = ['Shoot the Target', 'UNO', 'Age of Wars'];

        const loadAllRatings = async () => {
            const ratingsData = {};

            for (const gameTitle of gamesList) {
                const rating = await calculateGameRating(gameTitle);
                ratingsData[gameTitle] = rating;
            }

            setGamesData(ratingsData);
        };

        loadAllRatings();
    }, []);

    // Listen for rating changes in real-time
    useEffect(() => {
        const gamesList = ['Shoot the Target', 'UNO', 'Age of Wars'];
        const unsubscribes = [];

        gamesList.forEach(gameTitle => {
            const ratingsQuery = query(collection(db, 'games', gameTitle, 'ratings'));
            const unsubscribe = onSnapshot(ratingsQuery, async () => {
                const rating = await calculateGameRating(gameTitle);
                setGamesData(prev => ({
                    ...prev,
                    [gameTitle]: rating
                }));
            });
            unsubscribes.push(unsubscribe);
        });

        return () => {
            unsubscribes.forEach(unsubscribe => unsubscribe());
        };
    }, []);

    const handleLogout = async () => {
        try {
            await signOut(auth);
            navigate('/login');
        } catch (error) {
            console.error('Error signing out:', error);
        }
    };

    const handleGameSelect = (game) => {
        setSelectedGame(game);
        setShowGameModal(true);
    };

    const handlePlayGame = () => {
        setShowGameModal(false);
        if (selectedGame) {
            // Navigate to lobbies page instead of directly to the game
            navigate('/lobbies', {
                state: {
                    game: selectedGame
                }
            });
        }
    };

    const StarRating = ({ rating, size = 'normal' }) => {
        return (
            <div className={`stars ${size}`}>
                {[1, 2, 3, 4, 5].map((star) => (
                    <span
                        key={star}
                        className={`star ${star <= Math.round(rating) ? 'filled' : ''}`}
                    >
                        ★
                    </span>
                ))}
            </div>
        );
    };

    return (
        <div className="home-container">
            {/* User Info Section */}
            <div className="user-info-section">
                {user ? (
                    // Authenticated user view
                    <>
                        <div className="user-greeting">
                            <span>Welcome, <strong>{user.username || user.displayName || user.email}</strong></span>
                        </div>
                        <div className="user-actions">
                            {!user.isGuest && (
                                <>
                                    <button
                                        onClick={() => navigate('/profile')}
                                        className="edit-profile-button"
                                    >
                                        My Profile
                                    </button>
                                    <button
                                        onClick={() => setShowFriendsModal(true)}
                                        className="friends-button"
                                    >
                                        Friends
                                    </button>
                                </>
                            )}
                            <button onClick={handleLogout} className="logout-button">
                                Logout
                            </button>
                        </div>
                    </>
                ) : (
                    // Guest user view
                    <div className="guest-info-section">
                        <span>Welcome, <strong>Guest</strong></span>
                        <button onClick={() => navigate('/login')} className="edit-profile-button">
                            Login
                        </button>
                    </div>
                )}
            </div>

            {/* Games Section */}
            <div className="games-section">
                <h2>Our Games</h2>
                <div className="games-grid">
                    {/* Game 1: Shoot the Target */}
                    <div className="game-card">
                        <div className="game-image" style={{ backgroundImage: 'url(/assets/shoot-the-target.jpg)' }}></div>
                        <h3>Shoot the Target</h3>
                        <p>Test your precision in this archery challenge. Score points by hitting the bullseye!</p>
                        <div className="game-rating">
                            <StarRating rating={gamesData['Shoot the Target']?.averageRating || 0} />
                            <span className="rating-text">
                                {gamesData['Shoot the Target']?.totalRatings > 0 ?
                                    `${gamesData['Shoot the Target'].averageRating.toFixed(1)} (${gamesData['Shoot the Target'].totalRatings} rating${gamesData['Shoot the Target'].totalRatings !== 1 ? 's' : ''})` :
                                    'No ratings yet'}
                            </span>
                        </div>
                        <button
                            onClick={() => handleGameSelect({
                                title: 'Shoot the Target',
                                path: '/Games/shoot_the_target/shoot_the_target',
                                description: 'Test your precision in this multiplayer archery challenge!',
                                howToPlay: [
                                    'Click and hold to charge your bow',
                                    'Release to shoot the arrow',
                                    'Aim for the target\'s center for maximum points',
                                    'Watch out for wind and gravity effects'
                                ],
                                features: [
                                    'Real-time multiplayer gameplay',
                                    'Physics-based arrow trajectory',
                                    'Score tracking and leaderboards',
                                    'Multiple difficulty levels'
                                ],
                                averageRating: gamesData['Shoot the Target']?.averageRating || 0,
                                totalRatings: gamesData['Shoot the Target']?.totalRatings || 0
                            })}
                            className="play-button"
                        >
                            See Details
                        </button>
                    </div>

                    {/* Game 2: UNO */}
                    <div className="game-card">
                        <div className="game-image" style={{ backgroundImage: 'url(/assets/uno.png)' }}></div>
                        <h3>UNO</h3>
                        <p>The classic card game now online! Play with friends and use special cards to win.</p>
                        <div className="game-rating">
                            <StarRating rating={gamesData['UNO']?.averageRating || 0} />
                            <span className="rating-text">
                                {gamesData['UNO']?.totalRatings > 0 ?
                                    `${gamesData['UNO'].averageRating.toFixed(1)} (${gamesData['UNO'].totalRatings} rating${gamesData['UNO'].totalRatings !== 1 ? 's' : ''})` :
                                    'No ratings yet'}
                            </span>
                        </div>
                        <button
                            onClick={() => handleGameSelect({
                                title: 'UNO',
                                path: '/Games/UNO/uno',
                                description: 'The classic card game reimagined for online multiplayer!',
                                howToPlay: [
                                    'Match cards by color or number',
                                    'Use special cards to skip turns or reverse direction',
                                    'Say "UNO" when you have one card left',
                                    'Be the first to get rid of all your cards'
                                ],
                                features: [
                                    'Real-time multiplayer for up to 4 players',
                                    'Classic UNO rules and special cards',
                                    'In-game chat and reactions',
                                    'Game history tracking'
                                ]
                            })}
                            className="play-button"
                        >
                            See Details
                        </button>
                    </div>

                    {/* Game 3: Age of Wars */}
                    <div className="game-card">
                        <div className="game-image" style={{ backgroundImage: 'url(/assets/age-of-wars.png)' }}></div>
                        <h3>Age of Wars</h3>
                        <p>Build your empire, gather resources, and defeat opponents in this strategy game.</p>
                        <div className="game-rating">
                            <StarRating rating={gamesData['Age of Wars']?.averageRating || 0} />
                            <span className="rating-text">
                                {gamesData['Age of Wars']?.totalRatings > 0 ?
                                    `${gamesData['Age of Wars'].averageRating.toFixed(1)} (${gamesData['Age of Wars'].totalRatings} rating${gamesData['Age of Wars'].totalRatings !== 1 ? 's' : ''})` :
                                    'No ratings yet'}
                            </span>
                        </div>
                        <button
                            onClick={() => handleGameSelect({
                                title: 'Age of Wars',
                                path: '/Games/age_of_wars/age_of_wars',
                                description: 'Build, expand, and conquer in this epic strategy game!',
                                howToPlay: [
                                    'Start with a small settlement',
                                    'Gather resources to grow your empire',
                                    'Train troops and build defenses',
                                    'Engage in tactical battles with other players'
                                ],
                                features: [
                                    'Persistent world gameplay',
                                    'Multiple civilizations to choose from',
                                    'Complex economy and resource management',
                                    'Alliance system and diplomacy'
                                ]
                            })}
                            className="play-button"
                        >
                            See Details
                        </button>
                    </div>
                </div>
            </div>

            {/* Community Section */}
            <div className="community-section">
                <h2>Community</h2>
                <div className="community-actions">
                    <button
                        onClick={() => navigate('/players')}
                        className="community-button"
                    >
                        View Other Players
                    </button>
                    <button
                        onClick={() => navigate('/leaderboards')}
                        className="community-button"
                    >
                        View Leaderboards
                    </button>
                </div>
            </div>

            <GameModal
                isOpen={showGameModal}
                onClose={() => setShowGameModal(false)}
                onPlay={handlePlayGame}
                game={selectedGame}
            />

            <FriendsModal
                isOpen={showFriendsModal}
                onClose={() => setShowFriendsModal(false)}
                userId={user?.uid}
            />
        </div>
    );
}