import { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { updateProfile, onAuthStateChanged } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';

import './Profile.css';

export default function Profile() {
  const [userData, setUserData] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    avatarUrl: ''
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            setUserData(userDoc.data());
            setFormData({
              username: userDoc.data().username || '',
              avatarUrl: userDoc.data().avatarUrl || ''
            });
          }
        } catch (err) {
          setError('Failed to load profile data');
          console.error(err);
        } finally {
          setLoading(false);
        }
      } else {
        setLoading(false);
        setUserData(null);
      }
    });

    return () => unsubscribe(); // Cleanup on unmount
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    try {
      const user = auth.currentUser;
      if (user) {
        // Update Firestore document
        await updateDoc(doc(db, 'users', user.uid), {
          username: formData.username,
          avatarUrl: formData.avatarUrl,
          lastOnline: new Date()
        });

        // Update Firebase Auth display name
        await updateProfile(user, {
          displayName: formData.username
        });

        // Refresh data
        const updatedDoc = await getDoc(doc(db, 'users', user.uid));
        setUserData(updatedDoc.data());
        setEditMode(false);
      }
    } catch (err) {
      setError('Failed to update profile');
      console.error(err);
    }
  };

  // Helper function to render avatar with error handling
  const renderAvatar = () => {
    if (userData.avatarUrl) {
      return (
        <img
          src={userData.avatarUrl}
          alt="Profile"
          className="avatar"
          onError={(e) => {
            // Hide the image and show placeholder on error
            e.target.style.display = 'none';
            e.target.nextElementSibling.style.display = 'flex';
          }}
        />
      );
    }
    return null;
  };

  if (loading) return <div className="profile-loading">Loading profile...</div>;
  if (!userData) return <div className="profile-error">No profile data found</div>;

  return (
    <div className="profile-container">
      <h2>Your Profile</h2>
      {error && <div className="profile-error">{error}</div>}

      {editMode ? (
        <form onSubmit={handleSubmit} className="profile-form">
          <div className="form-group">
            <label>Username:</label>
            <input
              type="text"
              name="username"
              value={formData.username}
              onChange={handleInputChange}
              required
            />
          </div>

          <div className="form-group">
            <label>Avatar URL:</label>
            <input
              type="url"
              name="avatarUrl"
              value={formData.avatarUrl}
              onChange={handleInputChange}
              placeholder="https://example.com/avatar.jpg"
            />
          </div>

          <div className="form-actions">
            <button type="submit">Save Changes</button>
            <button type="button" onClick={() => setEditMode(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="profile-view">
          <div className="avatar-section">
            <div className="avatar-container">
              {renderAvatar()}
              <div
                className="avatar-placeholder"
                style={{
                  display: userData.avatarUrl ? 'none' : 'flex'
                }}
              >
                {userData.username?.charAt(0).toUpperCase() || 'U'}
              </div>
            </div>
          </div>

          <div className="profile-info">
            <p><strong>Username:</strong> {userData.username || 'Not set'}</p>
            <p><strong>Email:</strong> {userData.email}</p>
            <p><strong>Member since:</strong> {new Date(userData.createdAt?.toDate()).toLocaleDateString()}</p>
          </div>

          <div className="profile-stats">
            <h3>Game Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-value">{userData.stats?.sttElo || 0}</span>
                <span className="stat-label">Shoot The Target Elo</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{userData.stats?.unoElo || 0}</span>
                <span className="stat-label">UNO Elo</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{userData.stats?.aowElo || 0}</span>
                <span className="stat-label">Age of Wars Elo</span>
              </div>
            </div>
          </div>

          <div className="profile-actions">
            <button
              onClick={() => setEditMode(true)}
              className="profile-action-button"
            >
              Edit Profile
            </button>
            <button
              onClick={() => navigate('/')}
              className="profile-action-button home-button"
            >
              Back to Home
            </button>
          </div>
        </div>
      )}
    </div>
  );
}