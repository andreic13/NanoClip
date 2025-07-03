import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { auth, db } from './firebase';
import {
    collection,
    addDoc,
    query,
    orderBy,
    onSnapshot,
    getDoc,
    doc,
    updateDoc,
    deleteDoc,
    arrayUnion,
    arrayRemove,
    where,
    serverTimestamp
} from 'firebase/firestore';
import './Lobbies.css';

export default function Lobbies() {
    const navigate = useNavigate();
    const location = useLocation();
    const selectedGame = location.state?.game;

    const [lobbies, setLobbies] = useState([]);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [lobbyName, setLobbyName] = useState('');
    const [maxPlayers, setMaxPlayers] = useState(4);
    const [usernames, setUsernames] = useState({});
    const [userAvatars, setUserAvatars] = useState({}); // New state for avatars
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!selectedGame) {
            navigate('/');
            return;
        }

        // Listen to lobbies for this game
        const lobbiesQuery = query(
            collection(db, 'lobbies'),
            where('gameTitle', '==', selectedGame.title),
            where('status', '==', 'waiting')
        );

        const unsubscribe = onSnapshot(lobbiesQuery, async (snapshot) => {
            const lobbiesData = [];
            const userIds = new Set();

            snapshot.forEach(doc => {
                const lobbyData = { id: doc.id, ...doc.data() };
                lobbiesData.push(lobbyData);

                // Collect all user IDs
                if (lobbyData.host) userIds.add(lobbyData.host);
                if (lobbyData.players) {
                    lobbyData.players.forEach(playerId => userIds.add(playerId));
                }
                if (lobbyData.spectators) {
                    lobbyData.spectators.forEach(spectatorId => userIds.add(spectatorId));
                }
            });

            // Fetch usernames and avatars
            const usernameMap = {};
            const avatarMap = {}; // New map for avatars

            for (const userId of userIds) {
                try {
                    const userDoc = await getDoc(doc(db, 'users', userId));
                    if (userDoc.exists()) {
                        const userData = userDoc.data();
                        usernameMap[userId] = userData.username || userData.displayName || userData.email || 'Unknown User';
                        avatarMap[userId] = userData.avatarUrl || null; // Store avatar URL or null
                    }
                } catch (error) {
                    console.error('Error fetching user data:', error);
                    usernameMap[userId] = 'Unknown User';
                    avatarMap[userId] = null;
                }
            }

            setUsernames(usernameMap);
            setUserAvatars(avatarMap); // Set avatars state
            setLobbies(lobbiesData);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [selectedGame, navigate]);

    const handleCreateLobby = async () => {
        if (!lobbyName.trim() || !auth.currentUser) return;

        try {
            const lobbyData = {
                name: lobbyName.trim(),
                gameTitle: selectedGame.title,
                gamePath: selectedGame.path,
                host: auth.currentUser.uid,
                players: [auth.currentUser.uid],
                spectators: [],
                maxPlayers: maxPlayers,
                status: 'waiting',
                createdAt: serverTimestamp()
            };

            const docRef = await addDoc(collection(db, 'lobbies'), lobbyData);
            setShowCreateModal(false);
            setLobbyName('');

            // Navigate to the lobby room
            navigate(`/lobby/${docRef.id}`, {
                state: {
                    game: selectedGame,
                    isHost: true
                }
            });
        } catch (error) {
            console.error('Error creating lobby:', error);
            alert('Failed to create lobby. Please try again.');
        }
    };

    const handleJoinLobby = async (lobbyId, currentPlayers) => {
        if (!auth.currentUser) return;

        try {
            const lobbyRef = doc(db, 'lobbies', lobbyId);
            await updateDoc(lobbyRef, {
                players: arrayUnion(auth.currentUser.uid)
            });

            navigate(`/lobby/${lobbyId}`, {
                state: {
                    game: selectedGame,
                    isHost: false
                }
            });
        } catch (error) {
            console.error('Error joining lobby:', error);
            alert('Failed to join lobby. Please try again.');
        }
    };

    const handleSpectateLobby = async (lobbyId) => {
        if (!auth.currentUser) return;

        try {
            const lobbyRef = doc(db, 'lobbies', lobbyId);
            await updateDoc(lobbyRef, {
                spectators: arrayUnion(auth.currentUser.uid)
            });

            navigate(`/lobby/${lobbyId}`, {
                state: {
                    game: selectedGame,
                    isHost: false,
                    isSpectator: true
                }
            });
        } catch (error) {
            console.error('Error joining as spectator:', error);
            alert('Failed to join as spectator. Please try again.');
        }
    };

    // Component to render user avatar or initials
    const UserAvatar = ({ userId, className = "player-avatar" }) => {
        const avatarUrl = userAvatars[userId];
        const username = usernames[userId] || 'Unknown User';
        const initials = username.charAt(0).toUpperCase();

        return (
            <div className={className}>
                {avatarUrl ? (
                    <img
                        src={avatarUrl}
                        alt={username}
                        className="avatar-image"
                        onError={(e) => {
                            // Fallback to initials if image fails to load
                            e.target.style.display = 'none';
                            e.target.nextSibling.style.display = 'flex';
                        }}
                    />
                ) : null}
                <div
                    className="avatar-initials"
                    style={{ display: avatarUrl ? 'none' : 'flex' }}
                >
                    {initials}
                </div>
                <span className="player-name">
                    {username}
                </span>
            </div>
        );
    };

    if (!selectedGame) {
        return <div>Loading...</div>;
    }

    return (
        <div className="lobbies-container">
            {/* Header */}
            <div className="lobbies-header">
                <button
                    className="back-button"
                    onClick={() => navigate('/')}
                >
                    ← Back to Home
                </button>
                <div className="game-info">
                    <h1>{selectedGame.title} - Lobbies</h1>
                    <p>{selectedGame.description}</p>
                </div>
                <button
                    className="create-lobby-button"
                    onClick={() => setShowCreateModal(true)}
                >
                    Create Lobby
                </button>
            </div>

            {/* Lobbies List */}
            <div className="lobbies-content">
                {loading ? (
                    <div className="loading">Loading lobbies...</div>
                ) : lobbies.length === 0 ? (
                    <div className="no-lobbies">
                        <h3>No active lobbies</h3>
                        <p>Be the first to create a lobby for {selectedGame.title}!</p>
                    </div>
                ) : (
                    <div className="lobbies-grid">
                        {lobbies.map(lobby => (
                            <div key={lobby.id} className="lobby-card">
                                <div className="lobby-header">
                                    <h3 className="lobby-name">{lobby.name}</h3>
                                    <div className="lobby-status">
                                        <span className={`status-indicator ${lobby.status}`}>
                                            {lobby.status === 'waiting' ? 'Waiting' : 'In Game'}
                                        </span>
                                    </div>
                                </div>

                                <div className="lobby-info">
                                    <div className="lobby-detail">
                                        <strong>Host:</strong> {usernames[lobby.host] || 'Loading...'}
                                    </div>
                                    <div className="lobby-detail">
                                        <strong>Players:</strong> {lobby.players?.length || 0}/{lobby.maxPlayers}
                                    </div>
                                    <div className="lobby-detail">
                                        <strong>Spectators:</strong> {lobby.spectators?.length || 0}
                                    </div>
                                </div>

                                <div className="players-list">
                                    <h4>Players:</h4>
                                    <div className="players-avatars">
                                        {lobby.players?.map(playerId => (
                                            <UserAvatar key={playerId} userId={playerId} />
                                        ))}
                                    </div>
                                </div>

                                <div className="lobby-actions">
                                    {lobby.players && lobby.players.length < lobby.maxPlayers &&
                                        !lobby.players.includes(auth.currentUser?.uid) &&
                                        !lobby.spectators?.includes(auth.currentUser?.uid) ? (
                                        <button
                                            className="join-button"
                                            onClick={() => handleJoinLobby(lobby.id, lobby.players?.length || 0)}
                                        >
                                            Join Game
                                        </button>
                                    ) : null}

                                    {!lobby.players?.includes(auth.currentUser?.uid) &&
                                        !lobby.spectators?.includes(auth.currentUser?.uid) ? (
                                        <button
                                            className="spectate-button"
                                            onClick={() => handleSpectateLobby(lobby.id)}
                                        >
                                            Spectate
                                        </button>
                                    ) : null}

                                    {(lobby.players?.includes(auth.currentUser?.uid) ||
                                        lobby.spectators?.includes(auth.currentUser?.uid)) && (
                                            <button
                                                className="rejoin-button"
                                                onClick={() => navigate(`/lobby/${lobby.id}`, {
                                                    state: {
                                                        game: selectedGame,
                                                        isHost: lobby.host === auth.currentUser?.uid,
                                                        isSpectator: lobby.spectators?.includes(auth.currentUser?.uid)
                                                    }
                                                })}
                                            >
                                                Rejoin Lobby
                                            </button>
                                        )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Create Lobby Modal */}
            {showCreateModal && (
                <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Create New Lobby</h2>
                            <button
                                className="close-button"
                                onClick={() => setShowCreateModal(false)}
                            >
                                ×
                            </button>
                        </div>

                        <div className="modal-body">
                            <div className="form-group">
                                <label htmlFor="lobbyName">Lobby Name:</label>
                                <input
                                    id="lobbyName"
                                    type="text"
                                    value={lobbyName}
                                    onChange={(e) => setLobbyName(e.target.value)}
                                    placeholder="Enter lobby name..."
                                    maxLength={50}
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="maxPlayers">Max Players:</label>
                                <select
                                    id="maxPlayers"
                                    value={maxPlayers}
                                    disabled={selectedGame.title === 'Age of Wars' && maxPlayers > 2}
                                    onChange={(e) => setMaxPlayers(parseInt(e.target.value))}
                                >
                                    {selectedGame.title === 'Age of Wars' ? (
                                        <option value={2}>2 Players</option>
                                    ) : (
                                        <>
                                            <option value={2}>2 Players</option>
                                            <option value={3}>3 Players</option>
                                            <option value={4}>4 Players</option>
                                            <option value={6}>6 Players</option>
                                            <option value={8}>8 Players</option>
                                        </>
                                    )}
                                </select>
                            </div>
                        </div>

                        <div className="modal-footer">
                            <button
                                className="cancel-button"
                                onClick={() => setShowCreateModal(false)}
                            >
                                Cancel
                            </button>
                            <button
                                className="create-button"
                                // Make sure to setMaxPlayers to 2 for Age of Wars
                                onFocus={() => {
                                    if (selectedGame.title === 'Age of Wars') {
                                        setMaxPlayers(2);
                                    }
                                }}
                                onClick={handleCreateLobby}
                                disabled={!lobbyName.trim()}
                            >
                                Create Lobby
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}