import { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { auth, db } from './firebase';
import {
    doc,
    onSnapshot,
    updateDoc,
    deleteDoc,
    arrayRemove,
    arrayUnion,
    getDoc,
    serverTimestamp
} from 'firebase/firestore';
import './LobbyRoom.css';

export default function LobbyRoom() {
    const navigate = useNavigate();
    const { lobbyId } = useParams();
    const location = useLocation();
    const { game, isHost: initialIsHost, isSpectator: initialIsSpectator } = location.state || {};

    const [lobby, setLobby] = useState(null);
    const [usernames, setUsernames] = useState({});
    const [userAvatars, setUserAvatars] = useState({}); // New state for avatars
    const [loading, setLoading] = useState(true);
    const [isHost, setIsHost] = useState(initialIsHost || false);
    const [isSpectator, setIsSpectator] = useState(initialIsSpectator || false);
    const [showKickModal, setShowKickModal] = useState(false);
    const [playerToKick, setPlayerToKick] = useState(null);
    const [chatMessage, setChatMessage] = useState('');
    const [chatMessages, setChatMessages] = useState([]);

    useEffect(() => {
        if (!lobbyId || !auth.currentUser) {
            navigate('/');
            return;
        }

        // Listen to lobby changes
        const lobbyRef = doc(db, 'lobbies', lobbyId);
        const unsubscribe = onSnapshot(lobbyRef, async (docSnap) => {
            if (!docSnap.exists()) {
                // Lobby was deleted
                alert('This lobby has been closed.');
                navigate('/');
                return;
            }

            const lobbyData = { id: docSnap.id, ...docSnap.data() };
            setLobby(lobbyData);

            // Update host status
            setIsHost(lobbyData.host === auth.currentUser.uid);
            setIsSpectator(lobbyData.spectators?.includes(auth.currentUser.uid) || false);

            // Check if game has started
            if (lobbyData.status === 'playing' && lobbyData.gamePath) {
                navigate(lobbyData.gamePath, {
                    state: {
                        lobbyId: lobbyId,
                        players: lobbyData.players,
                        isHost: lobbyData.host === auth.currentUser.uid,
                        isSpectator: lobbyData.spectators?.includes(auth.currentUser.uid) || false
                    }
                });
                return;
            }

            // Collect all user IDs
            const userIds = new Set();
            if (lobbyData.host) userIds.add(lobbyData.host);
            if (lobbyData.players) {
                lobbyData.players.forEach(playerId => userIds.add(playerId));
            }
            if (lobbyData.spectators) {
                lobbyData.spectators.forEach(spectatorId => userIds.add(spectatorId));
            }

            // Fetch usernames and avatars
            const usernameMap = {};
            const avatarMap = {}; // New avatar map
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
            setUserAvatars(avatarMap); // Set avatar state
            setLoading(false);

            // Set chat messages if they exist
            if (lobbyData.chatMessages) {
                setChatMessages(lobbyData.chatMessages);
            }
        });

        return () => unsubscribe();
    }, [lobbyId, navigate]);

    const handleLeaveLobby = async () => {
        if (!auth.currentUser || !lobby) return;

        try {
            const lobbyRef = doc(db, 'lobbies', lobbyId);

            if (isHost) {
                // If host is leaving, delete the lobby
                await deleteDoc(lobbyRef);
                navigate('/lobbies', { state: { game } });
            } else {
                // Remove user from players or spectators
                const updateData = {};
                if (lobby.players?.includes(auth.currentUser.uid)) {
                    updateData.players = arrayRemove(auth.currentUser.uid);
                }
                if (lobby.spectators?.includes(auth.currentUser.uid)) {
                    updateData.spectators = arrayRemove(auth.currentUser.uid);
                }

                await updateDoc(lobbyRef, updateData);
                navigate('/lobbies', { state: { game } });
            }
        } catch (error) {
            console.error('Error leaving lobby:', error);
            alert('Failed to leave lobby. Please try again.');
        }
    };

    const handleKickPlayer = async (playerId) => {
        if (!isHost || !auth.currentUser) return;

        try {
            const lobbyRef = doc(db, 'lobbies', lobbyId);
            await updateDoc(lobbyRef, {
                players: arrayRemove(playerId),
                spectators: arrayRemove(playerId)
            });
            setShowKickModal(false);
            setPlayerToKick(null);
        } catch (error) {
            console.error('Error kicking player:', error);
            alert('Failed to kick player. Please try again.');
        }
    };

    const handleStartGame = async () => {
        if (!isHost || !lobby || lobby.players?.length < 2) return;

        console.log('Starting game for lobby:', lobbyId);

        try {
            const lobbyRef = doc(db, 'lobbies', lobbyId);
            await updateDoc(lobbyRef, {
                status: 'playing',
                startedAt: serverTimestamp()
            });
        } catch (error) {
            console.error('Error starting game:', error);
            alert('Failed to start game. Please try again.');
        }
    };

    const handleSwitchToSpectator = async () => {
        if (!auth.currentUser || isSpectator) return;

        try {
            const lobbyRef = doc(db, 'lobbies', lobbyId);
            await updateDoc(lobbyRef, {
                players: arrayRemove(auth.currentUser.uid),
                spectators: arrayUnion(auth.currentUser.uid)
            });
        } catch (error) {
            console.error('Error switching to spectator:', error);
            alert('Failed to switch to spectator. Please try again.');
        }
    };

    const handleJoinAsPlayer = async () => {
        if (!auth.currentUser || !isSpectator || lobby.players?.length >= lobby.maxPlayers) return;

        try {
            const lobbyRef = doc(db, 'lobbies', lobbyId);
            await updateDoc(lobbyRef, {
                spectators: arrayRemove(auth.currentUser.uid),
                players: arrayUnion(auth.currentUser.uid)
            });
        } catch (error) {
            console.error('Error joining as player:', error);
            alert('Failed to join as player. Please try again.');
        }
    };

    const handleSendMessage = async () => {
        if (!chatMessage.trim() || !auth.currentUser) return;

        try {
            const message = {
                id: Date.now().toString(),
                userId: auth.currentUser.uid,
                username: usernames[auth.currentUser.uid] || 'Unknown User',
                text: chatMessage.trim(),
                timestamp: new Date().toISOString()
            };

            const lobbyRef = doc(db, 'lobbies', lobbyId);
            await updateDoc(lobbyRef, {
                chatMessages: arrayUnion(message)
            });

            setChatMessage('');
        } catch (error) {
            console.error('Error sending message:', error);
        }
    };

    // Helper function to render avatar
    const renderAvatar = (userId, className = "player-avatar") => {
        const avatarUrl = userAvatars[userId];
        const username = usernames[userId];

        if (avatarUrl) {
            return (
                <div className={className}>
                    <img
                        src={avatarUrl}
                        alt={username || 'User avatar'}
                        onError={(e) => {
                            // Fallback to initial if image fails to load
                            e.target.style.display = 'none';
                            e.target.nextSibling.style.display = 'flex';
                        }}
                    />
                    <div
                        className={`${className} fallback`}
                        style={{ display: 'none' }}
                    >
                        {username?.charAt(0).toUpperCase() || '?'}
                    </div>
                </div>
            );
        } else {
            return (
                <div className={className}>
                    {username?.charAt(0).toUpperCase() || '?'}
                </div>
            );
        }
    };

    if (loading) {
        return <div className="loading">Loading lobby...</div>;
    }

    if (!lobby) {
        return <div className="error">Lobby not found.</div>;
    }

    return (
        <div className="lobby-room-container">
            {/* Header */}
            <div className="lobby-room-header">
                <button
                    className="leave-button"
                    onClick={handleLeaveLobby}
                >
                    ← {isHost ? 'Close Lobby' : 'Leave Lobby'}
                </button>
                <div className="lobby-info">
                    <h1>{lobby.name}</h1>
                    <p>{game?.title || lobby.gameTitle}</p>
                    {/* Display current players */}
                    {lobby.players && lobby.players.length > 0 && (
                        <div className="current-players">
                            <span className="players-label">Players: </span>
                            <span className="players-names">
                                {lobby.players.map((playerId, index) => (
                                    <span key={playerId}>
                                        {usernames[playerId] || 'Loading...'}
                                        {playerId === lobby.host && ' 👑'}
                                        {index < lobby.players.length - 1 && ', '}
                                    </span>
                                ))}
                            </span>
                        </div>
                    )}
                    <div className="lobby-status">
                        <span className={`status-indicator ${lobby.status}`}>
                            {lobby.status === 'waiting' ? 'Waiting for players' : 'Game in progress'}
                        </span>
                        {lobby.isPrivate && (
                            <span className="private-indicator">🔒 Private</span>
                        )}
                    </div>
                </div>
                {isHost && (
                    <button
                        className="start-game-button"
                        onClick={handleStartGame}
                        disabled={lobby.players?.length < 2}
                    >
                        Start Game ({lobby.players?.length || 0}/2+ players)
                    </button>
                )}
            </div>

            <div className="lobby-room-content">
                {/* Players Section */}
                <div className="players-section">
                    <div className="section-header">
                        <h2>Players ({lobby.players?.length || 0}/{lobby.maxPlayers})</h2>
                        {isSpectator && lobby.players?.length < lobby.maxPlayers && (
                            <button
                                className="join-player-button"
                                onClick={handleJoinAsPlayer}
                            >
                                Join as Player
                            </button>
                        )}
                    </div>
                    <div className="players-grid">
                        {lobby.players?.map(playerId => (
                            <div key={playerId} className="player-card">
                                {renderAvatar(playerId)}
                                <div className="player-info">
                                    <div className="player-name">
                                        {usernames[playerId] || 'Loading...'}
                                        {playerId === lobby.host && (
                                            <span className="host-badge">👑 Host</span>
                                        )}
                                    </div>
                                    {isHost && playerId !== auth.currentUser.uid && (
                                        <button
                                            className="kick-button"
                                            onClick={() => {
                                                setPlayerToKick(playerId);
                                                setShowKickModal(true);
                                            }}
                                        >
                                            Kick
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}

                        {/* Empty slots */}
                        {Array.from({ length: lobby.maxPlayers - (lobby.players?.length || 0) }).map((_, index) => (
                            <div key={`empty-${index}`} className="player-card empty">
                                <div className="player-avatar empty">
                                    +
                                </div>
                                <div className="player-info">
                                    <div className="player-name">Waiting for player...</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Spectators Section */}
                <div className="spectators-section">
                    <div className="section-header">
                        <h2>Spectators ({lobby.spectators?.length || 0})</h2>
                        {!isSpectator && !isHost && (
                            <button
                                className="spectate-button"
                                onClick={handleSwitchToSpectator}
                            >
                                Switch to Spectator
                            </button>
                        )}
                    </div>
                    <div className="spectators-list">
                        {lobby.spectators?.length === 0 ? (
                            <p className="no-spectators">No spectators</p>
                        ) : (
                            lobby.spectators?.map(spectatorId => (
                                <div key={spectatorId} className="spectator-item">
                                    {renderAvatar(spectatorId, "spectator-avatar")}
                                    <span className="spectator-name">
                                        {usernames[spectatorId] || 'Loading...'}
                                    </span>
                                    {isHost && spectatorId !== auth.currentUser.uid && (
                                        <button
                                            className="kick-button small"
                                            onClick={() => {
                                                setPlayerToKick(spectatorId);
                                                setShowKickModal(true);
                                            }}
                                        >
                                            Kick
                                        </button>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Chat Section */}
                <div className="chat-section">
                    <div className="section-header">
                        <h2>Chat</h2>
                    </div>
                    <div className="chat-messages">
                        {chatMessages.length === 0 ? (
                            <p className="no-messages">No messages yet. Say hello!</p>
                        ) : (
                            chatMessages.map(message => (
                                <div key={message.id} className="chat-message">
                                    <span className="message-author">{message.username}:</span>
                                    <span className="message-text">{message.text}</span>
                                </div>
                            ))
                        )}
                    </div>
                    <div className="chat-input">
                        <input
                            type="text"
                            value={chatMessage}
                            onChange={(e) => setChatMessage(e.target.value)}
                            placeholder="Type a message..."
                            maxLength={200}
                            onKeyPress={(e) => {
                                if (e.key === 'Enter') {
                                    handleSendMessage();
                                }
                            }}
                        />
                        <button
                            className="send-button"
                            onClick={handleSendMessage}
                            disabled={!chatMessage.trim()}
                        >
                            Send
                        </button>
                    </div>
                </div>
            </div>

            {/* Kick Player Modal */}
            {showKickModal && (
                <div className="modal-overlay" onClick={() => setShowKickModal(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Kick Player</h2>
                            <button
                                className="close-button"
                                onClick={() => setShowKickModal(false)}
                            >
                                ×
                            </button>
                        </div>
                        <div className="modal-body">
                            <p>Are you sure you want to kick {usernames[playerToKick]} from the lobby?</p>
                        </div>
                        <div className="modal-footer">
                            <button
                                className="cancel-button"
                                onClick={() => setShowKickModal(false)}
                            >
                                Cancel
                            </button>
                            <button
                                className="kick-confirm-button"
                                onClick={() => handleKickPlayer(playerToKick)}
                            >
                                Kick Player
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}