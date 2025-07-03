import { useState, useEffect } from 'react';
import { db, auth } from './firebase';
import { collection, query, getDocs, doc, updateDoc, getDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import './Players.css';

export default function Players() {
    const [players, setPlayers] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [currentUser, setCurrentUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        const fetchPlayers = async () => {
            try {
                // Get current user's data
                if (auth.currentUser) {
                    const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
                    setCurrentUser({
                        ...userDoc.data(),
                        id: auth.currentUser.uid
                    });
                }

                // Get all players
                const playersQuery = query(collection(db, 'users'));
                const snapshot = await getDocs(playersQuery);
                const playersData = snapshot.docs
                    .map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }))
                    .filter(player => player.id !== auth.currentUser?.uid); // Exclude current user

                setPlayers(playersData);
                setLoading(false);
            } catch (error) {
                console.error('Error fetching players:', error);
                setLoading(false);
            }
        };

        fetchPlayers();
    }, []);

    const handleAddFriend = async (playerId) => {
        if (!auth.currentUser) {
            navigate('/login');
            return;
        }

        try {
            // Get current user's data
            const userRef = doc(db, 'users', auth.currentUser.uid);
            const userDoc = await getDoc(userRef);
            const userData = userDoc.data() || {};

            // Get target player's data
            const playerRef = doc(db, 'users', playerId);
            const playerDoc = await getDoc(playerRef);

            if (!playerDoc.exists()) {
                console.error('Target player not found');
                return;
            }

            const playerData = playerDoc.data() || {};

            // Check if request already sent or if they're already friends
            const sentRequests = userData.sentRequests || [];
            const friends = userData.friends || [];

            if (sentRequests.includes(playerId) || friends.includes(playerId)) {
                return; // Already sent request or already friends
            }

            // Update both documents in sequence for better error handling
            try {
                // First, update current user's sent requests
                await updateDoc(userRef, {
                    sentRequests: [...sentRequests, playerId]
                });

                // Then, update target player's pending requests
                const pendingRequests = playerData.pendingRequests || [];
                await updateDoc(playerRef, {
                    pendingRequests: [...pendingRequests, auth.currentUser.uid]
                });

                // Update local state only after both operations succeed
                setCurrentUser(prev => ({
                    ...prev,
                    sentRequests: [...(prev?.sentRequests || []), playerId]
                }));

                console.log('Friend request sent successfully');

            } catch (updateError) {
                console.error('Error updating documents:', updateError);
                // If the second update fails, we should ideally rollback the first one
                // For now, just log the error
            }

        } catch (error) {
            console.error('Error sending friend request:', error);
        }
    };

    const filteredPlayers = players.filter(player =>
        player.username?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (loading) {
        return <div className="players-loading">Loading players...</div>;
    }

    return (
        <div className="players-container">
            <div className="players-header">
                <h1>Players</h1>
                <button onClick={() => navigate('/')} className="back-button">
                    Back to Home
                </button>
            </div>

            <div className="search-bar">
                <input
                    type="text"
                    placeholder="Search players..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>

            <div className="players-grid">
                {filteredPlayers.map(player => (
                    <div key={player.id} className="player-card">
                        <div className="player-avatar">
                            {player.avatarUrl ? (
                                <img src={player.avatarUrl} alt={player.username} />
                            ) : (
                                <div className="avatar-placeholder">
                                    {player.username?.[0]?.toUpperCase() || '?'}
                                </div>
                            )}
                        </div>
                        <div className="player-info">
                            <h2>{player.username}</h2>
                            <p>Shoot The Target Elo: {player.stats?.sttElo || 1000}</p>
                            <p>UNO Elo: {player.stats?.unoElo || 1000}</p>
                            <p>Age of Wars Elo: {player.stats?.aowElo || 1000}</p>
                        </div>
                        <button
                            onClick={() => handleAddFriend(player.id)}
                            className={`add-friend-button ${currentUser?.friends?.includes(player.id) ? 'added' :
                                    currentUser?.sentRequests?.includes(player.id) ? 'pending' : ''
                                }`}
                            disabled={currentUser?.friends?.includes(player.id) ||
                                currentUser?.sentRequests?.includes(player.id)}
                        >
                            {currentUser?.friends?.includes(player.id) ? 'Friend Added' :
                                currentUser?.sentRequests?.includes(player.id) ? 'Request Sent' :
                                    'Add Friend'}
                        </button>
                    </div>
                ))}
                {filteredPlayers.length === 0 && (
                    <div className="no-results">No players found</div>
                )}
            </div>
        </div>
    );
}