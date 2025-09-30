const request = require('supertest');
const express = require('express');

// Mock dependencies
jest.mock('../database/database.js', () => ({
  DB: {
    getFranchises: jest.fn(),
    getUserFranchises: jest.fn(),
    createFranchise: jest.fn(),
    deleteFranchise: jest.fn(),
    getFranchise: jest.fn(),
    createStore: jest.fn(),
    deleteStore: jest.fn(),
  },
  Role: {
    Admin: 'admin',
  },
}));
jest.mock('./authRouter.js', () => ({
  authRouter: {
    authenticateToken: (req, res, next) => {
      if (req.headers['authorization'] === 'Bearer admin-token') {
        req.user = { id: 1, roles: [{ role: 'admin' }], isRole: (r) => r === 'admin' };
        next();
      } else if (req.headers['authorization'] === 'Bearer user-token') {
        req.user = { id: 2, roles: [{ role: 'diner' }], isRole: () => false };
        next();
      } else {
        res.status(401).json({ message: 'unauthorized' });
      }
    },
  },
}));

const { DB } = require('../database/database.js');
const franchiseRouter = require('./franchiseRouter.js');

const app = express();
app.use(express.json());
app.use('/api/franchise', franchiseRouter);

describe('franchiseRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/franchise', () => {
    test('returns franchises list', async () => {
      DB.getFranchises.mockResolvedValue([
        [{ id: 1, name: 'pizzaPocket', admins: [], stores: [] }, /* more */], true,
      ]);

      const res = await request(app).get('/api/franchise');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('franchises');
      expect(res.body).toHaveProperty('more');
      expect(DB.getFranchises).toHaveBeenCalled();
    });
  });

  describe('GET /api/franchise/:userId', () => {
    test('returns user franchises if user authorized', async () => {
      DB.getUserFranchises.mockResolvedValue([{ id: 2, name: 'pizzaPocket', admins: [], stores: [] }]);

      const res = await request(app)
        .get('/api/franchise/2')
        .set('Authorization', 'Bearer user-token');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(DB.getUserFranchises).toHaveBeenCalledWith(2);
    });

    test('returns empty array if unauthorized', async () => {
      const res = await request(app)
        .get('/api/franchise/3') // userId 3 differs from authenticated user 2, and not admin
        .set('Authorization', 'Bearer user-token');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      expect(DB.getUserFranchises).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/franchise', () => {
    test('creates franchise if admin', async () => {
      const franchiseData = { name: 'pizzaPocket', admins: [{ email: 'f@jwt.com' }] };
      DB.createFranchise.mockResolvedValue({ ...franchiseData, id: 1 });

      const res = await request(app)
        .post('/api/franchise')
        .set('Authorization', 'Bearer admin-token')
        .send(franchiseData);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id', 1);
      expect(DB.createFranchise).toHaveBeenCalledWith(franchiseData);
    });

    test('rejects if not admin', async () => {
      const res = await request(app)
        .post('/api/franchise')
        .set('Authorization', 'Bearer user-token')
        .send({});

      expect(res.status).toBe(403);
      expect(DB.createFranchise).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/franchise/:franchiseId', () => {
    test('deletes franchise', async () => {
      DB.deleteFranchise.mockResolvedValue();

      const res = await request(app)
        .delete('/api/franchise/1')
        .set('Authorization', 'Bearer admin-token'); // no auth required in code but good to include

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('franchise deleted');
      expect(DB.deleteFranchise).toHaveBeenCalledWith(1);
    });
  });

  describe('POST /api/franchise/:franchiseId/store', () => {
    test('creates store if authorized', async () => {
      DB.getFranchise.mockResolvedValue({
        id: 1,
        admins: [{ id: 1 }],
      });
      DB.createStore.mockResolvedValue({ id: 10, name: 'SLC', totalRevenue: 0 });

      const res = await request(app)
        .post('/api/franchise/1/store')
        .set('Authorization', 'Bearer admin-token')
        .send({ name: 'SLC' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('name', 'SLC');
      expect(DB.createStore).toHaveBeenCalledWith(1, { name: 'SLC' });
    });

    test('rejects unauthorized users', async () => {
      DB.getFranchise.mockResolvedValue({ id: 1, admins: [{ id: 999 }] }); // other admin

      const res = await request(app)
        .post('/api/franchise/1/store')
        .set('Authorization', 'Bearer user-token') // user id 2 is different from req.user.id 2, mock isRole false
        .send({ name: 'SLC' });

      expect(res.status).toBe(403);
      expect(DB.createStore).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/franchise/:franchiseId/store/:storeId', () => {
    test('deletes store if authorized', async () => {
      DB.getFranchise.mockResolvedValue({ id: 1, admins: [{ id: 1 }] });
      DB.deleteStore.mockResolvedValue();

      const res = await request(app)
        .delete('/api/franchise/1/store/2')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('store deleted');
      expect(DB.deleteStore).toHaveBeenCalledWith(1, 2);
    });

    test('rejects unauthorized store deletion', async () => {
      DB.getFranchise.mockResolvedValue({ id: 1, admins: [{ id: 999 }] });

      const res = await request(app)
        .delete('/api/franchise/1/store/2')
        .set('Authorization', 'Bearer user-token');

      expect(res.status).toBe(403);
      expect(DB.deleteStore).not.toHaveBeenCalled();
    });
  });
});
