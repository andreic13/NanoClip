import { useState, useEffect } from 'react';
import { db } from './firebase';
import { doc, getDoc, runTransaction } from 'firebase/firestore';
import './FriendsModal.css';

export default function FriendsModal({ isOpen, onClose, userId }) {
    const [friends, setFriends] = useState([]);
    const [pendingRequests, setPendingRequests] = useState([]);
    const [sentRequests, setSentRequests] = useState([]);
    const [activeTab, setActiveTab] = useState('friends');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const fetchFriendsData = async () => {
            if (!userId) return;

            try {
                const userDoc = await getDoc(doc(db, 'users', userId));
                const userData = userDoc.data();

                // Fetch friends
                const friendsList = await Promise.all(
                    (userData?.friends || []).map(async (friendId) => {
                        const friendDoc = await getDoc(doc(db, 'users', friendId));
                        return { id: friendId, ...friendDoc.data() };
                    })
                );
                setFriends(friendsList);

                // Fetch pending requests
                const pendingList = await Promise.all(
                    (userData?.pendingRequests || []).map(async (senderId) => {
                        const senderDoc = await getDoc(doc(db, 'users', senderId));
                        return { id: senderId, ...senderDoc.data() };
                    })
                );
                setPendingRequests(pendingList);

                // Fetch sent requests
                const sentList = await Promise.all(
                    (userData?.sentRequests || []).map(async (receiverId) => {
                        const receiverDoc = await getDoc(doc(db, 'users', receiverId));
                        return { id: receiverId, ...receiverDoc.data() };
                    })
                );
                setSentRequests(sentList);
            } catch (error) {
                console.error('Error fetching friends data:', error);
            }
        };

        if (isOpen) {
            fetchFriendsData();
        }
    }, [isOpen, userId]);

    const handleAcceptRequest = async (senderId) => {
        if (loading) return;
        setLoading(true);

        try {
            await runTransaction(db, async (transaction) => {
                // Get current user's document
                const userRef = doc(db, 'users', userId);
                const userDoc = await transaction.get(userRef);

                if (!userDoc.exists()) {
                    throw new Error("User document does not exist!");
                }

                // Get sender's document
                const senderRef = doc(db, 'users', senderId);
                const senderDoc = await transaction.get(senderRef);

                if (!senderDoc.exists()) {
                    throw new Error("Sender document does not exist!");
                }

                const userData = userDoc.data();
                const senderData = senderDoc.data();

                // Update current user's document
                transaction.update(userRef, {
                    friends: [...(userData.friends || []), senderId],
                    pendingRequests: (userData.pendingRequests || []).filter(id => id !== senderId)
                });

                // Update sender's document
                transaction.update(senderRef, {
                    friends: [...(senderData.friends || []), userId],
                    sentRequests: (senderData.sentRequests || []).filter(id => id !== userId)
                });
            });

            // Update local state
            setFriends(prev => [...prev, pendingRequests.find(p => p.id === senderId)]);
            setPendingRequests(prev => prev.filter(p => p.id !== senderId));
            setSentRequests(prev => prev.filter(p => p.id !== senderId));

            console.log('Friend request accepted successfully');
        } catch (error) {
            console.error('Error accepting friend request:', error);
            // You might want to show a user-friendly error message here
        } finally {
            setLoading(false);
        }
    };

    const handleRejectRequest = async (senderId) => {
        if (loading) return;
        setLoading(true);

        try {
            await runTransaction(db, async (transaction) => {
                // Get current user's document
                const userRef = doc(db, 'users', userId);
                const userDoc = await transaction.get(userRef);

                if (!userDoc.exists()) {
                    throw new Error("User document does not exist!");
                }

                // Get sender's document
                const senderRef = doc(db, 'users', senderId);
                const senderDoc = await transaction.get(senderRef);

                if (!senderDoc.exists()) {
                    throw new Error("Sender document does not exist!");
                }

                const userData = userDoc.data();
                const senderData = senderDoc.data();

                // Update current user's document
                transaction.update(userRef, {
                    pendingRequests: (userData.pendingRequests || []).filter(id => id !== senderId)
                });

                // Update sender's document
                transaction.update(senderRef, {
                    sentRequests: (senderData.sentRequests || []).filter(id => id !== userId)
                });
            });

            // Update local state
            setPendingRequests(prev => prev.filter(p => p.id !== senderId));
            setSentRequests(prev => prev.filter(p => p.id !== senderId));

            console.log('Friend request rejected successfully');
        } catch (error) {
            console.error('Error rejecting friend request:', error);
            // You might want to show a user-friendly error message here
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="friends-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Friends List</h2>
                    <button className="close-button" onClick={onClose}>&times;</button>
                </div>

                <div className="tabs">
                    <button
                        className={`tab ${activeTab === 'friends' ? 'active' : ''}`}
                        onClick={() => setActiveTab('friends')}
                    >
                        Friends ({friends.length})
                    </button>
                    <button
                        className={`tab ${activeTab === 'pending' ? 'active' : ''}`}
                        onClick={() => setActiveTab('pending')}
                    >
                        Pending ({pendingRequests.length})
                    </button>
                    <button
                        className={`tab ${activeTab === 'sent' ? 'active' : ''}`}
                        onClick={() => setActiveTab('sent')}
                    >
                        Sent ({sentRequests.length})
                    </button>
                </div>

                <div className="friends-list">
                    {activeTab === 'friends' && friends.map(friend => (
                        <div key={friend.id} className="friend-item">
                            <div className="friend-info">
                                <div className="friend-avatar">
                                    {friend.username?.[0]?.toUpperCase() || '?'}
                                </div>
                                <span>{friend.username}</span>
                            </div>
                        </div>
                    ))}

                    {activeTab === 'pending' && pendingRequests.map(sender => (
                        <div key={sender.id} className="friend-item">
                            <div className="friend-info">
                                <div className="friend-avatar">
                                    {sender.username?.[0]?.toUpperCase() || '?'}
                                </div>
                                <span>{sender.username}</span>
                            </div>
                            <div className="request-actions">
                                <button
                                    className="accept-button"
                                    onClick={() => handleAcceptRequest(sender.id)}
                                    disabled={loading}
                                >
                                    {loading ? 'Processing...' : 'Accept'}
                                </button>
                                <button
                                    className="reject-button"
                                    onClick={() => handleRejectRequest(sender.id)}
                                    disabled={loading}
                                >
                                    {loading ? 'Processing...' : 'Reject'}
                                </button>
                            </div>
                        </div>
                    ))}

            {activeTab === 'sent' && sentRequests.map(receiver => (
                <div key={receiver.id} className="friend-item">
                    <div className="friend-info">
                        <div className="friend-avatar">
                            {receiver.username?.[0]?.toUpperCase() || '?'}
                        </div>
                        <span>{receiver.username}</span>
                    </div>
                    <span className="pending-text">Pending...</span>
                </div>
            ))}

            {activeTab === 'friends' && friends.length === 0 && (
                <div className="empty-state">No friends added yet</div>
            )}
            {activeTab === 'pending' && pendingRequests.length === 0 && (
                <div className="empty-state">No pending requests</div>
            )}
            {activeTab === 'sent' && sentRequests.length === 0 && (
                <div className="empty-state">No sent requests</div>
            )}
        </div>
            </div >
        </div >
    );
}