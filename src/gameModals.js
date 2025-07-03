import { useState, useEffect } from 'react';
import { db } from './firebase';  // Update this import to get Firestore instance
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
import { auth } from './firebase';

export default function GameModal({ isOpen, onClose, onPlay, game }) {
    const [comments, setComments] = useState([]);
    const [newComment, setNewComment] = useState('');
    const [usernames, setUsernames] = useState({});

    const [userRating, setUserRating] = useState(0);
    const [averageRating, setAverageRating] = useState(0);
    const [totalRatings, setTotalRatings] = useState(0);
    const [hasRated, setHasRated] = useState(false);

    useEffect(() => {
        if (!game) return;

        const commentsQuery = query(
            collection(db, 'games', game.title, 'comments'),
            orderBy('timestamp', 'desc')
        );

        const unsubscribe = onSnapshot(commentsQuery, async (snapshot) => {
            const commentsArray = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Get unique user IDs from comments
            const userIds = [...new Set(commentsArray.map(comment => comment.userId))];

            // Fetch current usernames for all users
            const userDataPromises = userIds.map(async userId => {
                const userDoc = await getDoc(doc(db, 'users', userId));
                return [userId, userDoc.data()?.username || userDoc.data()?.email || 'Unknown User'];
            });

            const userData = await Promise.all(userDataPromises);
            const usernameMap = Object.fromEntries(userData);

            setUsernames(usernameMap);
            setComments(commentsArray);
        });

        return () => unsubscribe();
    }, [game]);

    useEffect(() => {
        if (!game || !auth.currentUser) return;

        // Get user's rating if exists
        const getUserRating = async () => {
            const ratingRef = doc(db, 'games', game.title, 'ratings', auth.currentUser.uid);
            const ratingDoc = await getDoc(ratingRef);
            if (ratingDoc.exists()) {
                setUserRating(ratingDoc.data().rating);
                setHasRated(true);
            } else {
                setUserRating(0);
                setHasRated(false);
            }
        };

        // Get average rating
        const getRatings = async () => {
            const ratingsQuery = query(collection(db, 'games', game.title, 'ratings'));
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

                if (count > 0) {
                    setAverageRating(total / count);
                    setTotalRatings(count);
                } else {
                    setAverageRating(0);
                    setTotalRatings(0);
                }
            } else {
                setAverageRating(0);
                setTotalRatings(0);
            }
        };

        getUserRating();
        getRatings();
    }, [game]);

    const handleAddComment = async () => {
        if (!newComment.trim() || !game || !auth.currentUser) return;

        try {
            await addDoc(collection(db, 'games', game.title, 'comments'), {
                text: newComment.trim(),
                userId: auth.currentUser.uid,
                timestamp: new Date().getTime()
            });

            setNewComment('');
        } catch (error) {
            console.error('Error adding comment:', error);
        }
    };

    const handleRating = async (rating) => {
        if (!auth.currentUser || !game) return;

        try {
            const ratingRef = doc(db, 'games', game.title, 'ratings', auth.currentUser.uid);

            // Use setDoc with merge to update existing or create new
            await setDoc(ratingRef, {
                rating,
                userId: auth.currentUser.uid,
                timestamp: new Date().getTime()
            }, { merge: true });

            // Recalculate average after rating
            const ratingsQuery = query(collection(db, 'games', game.title, 'ratings'));
            const snapshot = await getDocs(ratingsQuery);

            let total = 0;
            let count = 0;
            snapshot.forEach(doc => {
                const docRating = doc.data().rating;
                if (docRating && !isNaN(docRating)) {
                    total += docRating;
                    count++;
                }
            });

            const newAverage = count > 0 ? total / count : 0;

            // Remove the game document update - just update local state
            setUserRating(rating);
            setHasRated(true);
            setAverageRating(newAverage);
            setTotalRatings(count);

        } catch (error) {
            console.error('Error rating game:', error);
        }
    };

    const StarRating = ({ rating, onRate }) => {
        return (
            <div className="star-rating">
                {[1, 2, 3, 4, 5].map((star) => (
                    <span
                        key={star}
                        className={`star ${star <= rating ? 'filled' : ''}`}
                        onClick={() => onRate(star)}
                    >
                        ★
                    </span>
                ))}
            </div>
        );
    };

    if (!isOpen || !game) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">{game.title}</h2>
                    <button className="close-button" onClick={onClose}>&times;</button>
                </div>

                <div className="modal-body">
                    <div className="game-details">
                        <div className="detail-section">
                            <div className="detail-title">Description</div>
                            <p>{game.description}</p>
                        </div>

                        <div className="detail-section">
                            <div className="detail-title">Rating</div>
                            <div className="rating-container">
                                <div className="average-rating">
                                    <span className="rating-number">{averageRating.toFixed(1)}</span>
                                    <StarRating rating={Math.round(averageRating)} onRate={() => { }} />
                                    <span className="total-ratings">({totalRatings} ratings)</span>
                                </div>
                                {auth.currentUser && (
                                    <div className="user-rating">
                                        <p>Your Rating:</p>
                                        <StarRating
                                            rating={userRating}
                                            onRate={handleRating}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="detail-section">
                            <div className="detail-title">How to Play</div>
                            <ul>
                                {game.howToPlay.map((step, index) => (
                                    <li key={index}>{step}</li>
                                ))}
                            </ul>
                        </div>

                        <div className="detail-section">
                            <div className="detail-title">Features</div>
                            <ul>
                                {game.features.map((feature, index) => (
                                    <li key={index}>{feature}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                    {/* Comments section */}
                    <div className="comments-section">
                        <h3 className="comments-title">Comments</h3>

                        {/* Add comment form */}
                        {auth.currentUser && (
                            <div className="comment-form">
                                <textarea
                                    value={newComment}
                                    onChange={(e) => setNewComment(e.target.value)}
                                    placeholder="Write a comment..."
                                    className="comment-input"
                                />
                                <button
                                    onClick={handleAddComment}
                                    className="comment-submit-button"
                                >
                                    Post Comment
                                </button>
                            </div>
                        )}

                        {/* Comments list */}
                        {comments.map(comment => (
                            <div key={comment.id} className="comment">
                                <div className="comment-header">
                                    <span className="comment-author">
                                        {usernames[comment.userId] || 'Loading...'}
                                    </span>
                                    <span className="comment-date">
                                        {new Date(comment.timestamp).toLocaleString()}
                                    </span>
                                </div>
                                <p className="comment-text">{comment.text}</p>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="modal-button play-now-button" onClick={onPlay}>
                        Play Now
                    </button>
                </div>
            </div>
        </div>
    );
}