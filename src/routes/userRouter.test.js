const request = require('supertest');
const express = require('express');

// Mock dependencies
jest.mock('../database/database.js');
jest.mock('./authRouter.js', () => ({
  authRouter: {
    authenticateToken: (req, res, next) => {
      // Middleware to simulate authenticated user is attached to req.user
      if (req.headers['authorization'] === 'Bearer valid-admin-token') {
        req.user = { id: 999, roles: [{ role: 'admin' }], isRole: (r) => r === 'admin' };
        next();
      } else if (req.headers['authorization'] === 'Bearer valid-user-token') {
        req.user = { id: 1, roles: [{ role: 'diner' }], isRole: () => false };
        next();
      } else {
        res.status(401).json({ message: 'unauthorized' });
      }
    },
  },
  setAuth: jest.fn().mockResolvedValue('new.token'),
}));

const { DB } = require('../database/database.js');
const { setAuth } = require('./authRouter.js');
const userRouter = require('./userRouter.js');

const app = express();
app.use(express.json());
app.use('/api/user', userRouter);

describe('GET /api/user/me', () => {
test('responds with authenticated user info', async () => {
    const res = await request(app)
    .get('/api/user/me')
    .set('Authorization', 'Bearer valid-user-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 1);
});

test('returns 401 unauthorized if no token', async () => {
    const res = await request(app).get('/api/user/me');
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/unauthorized/i);
});
});

describe('PUT /api/user/:userId', () => {
const updateData = { name: 'Updated Name', email: 'updated@test.com', password: 'newpass' };

beforeEach(() => {
    DB.updateUser.mockClear();
    setAuth.mockClear();
});

test('allows user to update their own info', async () => {
    DB.updateUser.mockResolvedValue({ id: 1, ...updateData, roles: [{ role: 'diner' }] });

    const res = await request(app)
    .put('/api/user/1')
    .send(updateData)
    .set('Authorization', 'Bearer valid-user-token');

    expect(res.status).toBe(200);
    expect(DB.updateUser).toHaveBeenCalledWith(1, updateData.name, updateData.email, updateData.password);
    expect(setAuth).toHaveBeenCalled();
    expect(res.body.user).toMatchObject({ id: 1, name: 'Updated Name' });
    expect(res.body.token).toBe('new.token');
});

test('allows admin to update other user info', async () => {
    DB.updateUser.mockResolvedValue({ id: 2, ...updateData, roles: [{ role: 'diner' }] });

    const res = await request(app)
    .put('/api/user/2')
    .send(updateData)
    .set('Authorization', 'Bearer valid-admin-token');

    expect(res.status).toBe(200);
    expect(DB.updateUser).toHaveBeenCalledWith(2, updateData.name, updateData.email, updateData.password);
    expect(setAuth).toHaveBeenCalled();
    expect(res.body.user).toMatchObject({ id: 2, name: 'Updated Name' });
});

test('returns 403 forbidden if user updates another user without admin role', async () => {
    const res = await request(app)
    .put('/api/user/2')
    .send(updateData)
    .set('Authorization', 'Bearer valid-user-token');

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/unauthorized/i);
    expect(DB.updateUser).not.toHaveBeenCalled();
    expect(setAuth).not.toHaveBeenCalled();
});

test('returns 401 if not authenticated', async () => {
    const res = await request(app).put('/api/user/1').send(updateData);

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/unauthorized/i);
    expect(DB.updateUser).not.toHaveBeenCalled();
});
});
