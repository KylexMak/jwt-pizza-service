const request = require('supertest');
const express = require('express');

//Mock Dependencies
jest.mock('jsonwebtoken');
jest.mock('../database/database.js', () => ({
  DB: {
    isLoggedIn: jest.fn().mockResolvedValue(true),
    addUser: jest.fn().mockResolvedValue(testUser),
    getUser: jest.fn().mockResolvedValue(testUser),
    loginUser: jest.fn().mockResolvedValue(true),
    logoutUser: jest.fn().mockResolvedValue(true),
  },
  Role: {
    Diner: 'diner',
  },
}));

const { authRouter, setAuthUser } = require('./authRouter.js');
const { DB } = require('../database/database.js');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(setAuthUser);
app.use('/api/auth', authRouter);

//Test User
const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };

//Setup/Cleanup
beforeEach(() => {
    jest.clearAllMocks();
    DB.isLoggedIn.mockResolvedValue(true);
    DB.addUser.mockResolvedValue(testUser);
    DB.getUser.mockResolvedValue(testUser);
    DB.loginUser.mockResolvedValue(true);
    DB.logoutUser.mockResolvedValue(true);
    jwt.sign.mockReturnValue('signed.jwt.token');
    jwt.verify.mockReturnValue(testUser);
});

describe('POST /api/auth (register)', () => {
    test('registers a valid user', async () => {
        const res = await request(app).post('/api/auth').send(testUser);
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('token', 'signed.jwt.token');
        expect(res.body.user.email).toBe(testUser.email);
    });
    test('rejects if missing required fields', async () => {
        const res = await request(app).post('/api/auth').send({ name: '', email: '', password: '' });
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toMatch(/required/);
    });
});

describe('PUT /api/auth (login)', () => {
    test('logs user in with correct credentials', async () => {
        const res = await request(app).put('/api/auth').send({ email: testUser.email, password: testUser.password });
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('token', 'signed.jwt.token');
    });

    test('fails with wrong credentials', async () => {
        DB.getUser.mockResolvedValue(null); //Simulate not found
        const res = await request(app).put('/api/auth').send({ email: 'nope', password: 'nope' });
        expect(res.body.token).toBeUndefined();
    });
});

describe('DELETE /api/auth (logout)', () => {
    test('logs out with valid token', async () => {
        jwt.verify.mockReturnValue(testUser);
        DB.isLoggedIn.mockResolvedValue(true);
        const res = await request(app).delete('/api/auth').set('Authorization', 'Bearer valid.token.here');
        expect(res.statusCode).toBe(200);
        expect(res.body.message).toBe("logout successful");
    });
    test('fails logout with invalid token', async () => {
        DB.isLoggedIn.mockResolvedValue(false);
        jwt.verify.mockImplementation(() => { throw new Error('invalid token'); });
        const res = await request(app).delete('/api/auth');
        expect(res.statusCode).toBe(401);
        expect(res.body.message).toBe("unauthorized");
    });
});