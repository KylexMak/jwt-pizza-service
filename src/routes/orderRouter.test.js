const request = require('supertest');
const express = require('express');

jest.mock('../database/database.js', () => ({
  DB: {
    getMenu: jest.fn(),
    addMenuItem: jest.fn(),
    getOrders: jest.fn(),
    addDinerOrder: jest.fn(),
  },
  Role: {
    Admin: 'admin',
  },
}));

jest.mock('./authRouter.js', () => ({
  authRouter: {
    authenticateToken: (req, res, next) => {
      if (req.headers.authorization === 'Bearer admin-token') {
        req.user = { id: 1, roles: [{ role: 'admin' }], isRole: (r) => r === 'admin' };
        next();
      } else if (req.headers.authorization === 'Bearer user-token') {
        req.user = { id: 2, roles: [{ role: 'diner' }], isRole: () => false };
        next();
      } else {
        res.status(401).json({ message: 'unauthorized' });
      }
    },
  },
}));

if (process.env.VSCODE_INSPECTOR_OPTIONS) {
  jest.setTimeout(60 * 1000 * 5); // 5 minutes
}

const { DB } = require('../database/database.js');
const orderRouter = require('./orderRouter.js');

const app = express();
app.use(express.json());
app.use('/api/order', orderRouter);

describe('orderRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  describe('GET /api/order/menu', () => {
    test('returns menu items', async () => {
      const menu = [{ id: 1, title: 'Veggie', price: 0.0038 }];
      DB.getMenu.mockResolvedValue(menu);

      const res = await request(app).get('/api/order/menu');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(menu);
      expect(DB.getMenu).toHaveBeenCalled();
    });
  });

  describe('PUT /api/order/menu', () => {
    test('allows admin to add a menu item', async () => {
      DB.addMenuItem.mockResolvedValue({});
      DB.getMenu.mockResolvedValue([{ id: 2, title: 'Student' }]);

      const newItem = { title: 'Student', description: 'No topping', image: 'pizza9.png', price: 0.0001 };
      const res = await request(app)
        .put('/api/order/menu')
        .set('Authorization', 'Bearer admin-token')
        .send(newItem);

      expect(res.status).toBe(200);
      expect(DB.addMenuItem).toHaveBeenCalledWith(newItem);
      expect(DB.getMenu).toHaveBeenCalled();
      expect(res.body).toEqual([{ id: 2, title: 'Student' }]);
    });

    test('rejects non-admin user', async () => {
      const newItem = { title: 'Student', description: 'No topping', image: 'pizza9.png', price: 0.0001 };
      const res = await request(app)
        .put('/api/order/menu')
        .set('Authorization', 'Bearer user-token')
        .send(newItem);

      expect(res.status).toBe(403);
      expect(DB.addMenuItem).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/order', () => {
    it('returns orders for authenticated user', async () => {
      const orders = { dinerId: 2, orders: [{ id: 1, items: [] }], page: 1 };
      DB.getOrders.mockResolvedValue(orders);

      const res = await request(app)
        .get('/api/order')
        .set('Authorization', 'Bearer user-token');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(orders);
      expect(DB.getOrders).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), undefined);
    });

    it('returns 401 if unauthorized', async () => {
      const res = await request(app).get('/api/order');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/order', () => {
    test('creates an order and calls factory API successfully', async () => {
      const orderReq = { franchiseId: 1, storeId: 1, items: [{ menuId: 1, description: 'Veggie', price: 0.05 }] };
      const createdOrder = { ...orderReq, id: 123 };
      DB.addDinerOrder.mockResolvedValue(createdOrder);

      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ reportUrl: 'http://url', jwt: 'jwt-token' }),
      });

      const res = await request(app)
        .post('/api/order')
        .set('Authorization', 'Bearer user-token')
        .send(orderReq);

      expect(res.status).toBe(200);
      expect(DB.addDinerOrder).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), orderReq);
      expect(fetch).toHaveBeenCalled();
      expect(res.body).toEqual({
        order: createdOrder,
        followLinkToEndChaos: 'http://url',
        jwt: 'jwt-token',
      });
    });

    test('returns 500 on factory API failure', async () => {
      const orderReq = { franchiseId: 1, storeId: 1, items: [] };
      const createdOrder = { ...orderReq, id: 123 };
      DB.addDinerOrder.mockResolvedValue(createdOrder);

      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ reportUrl: 'http://fail'}),
      });

      const res = await request(app)
        .post('/api/order')
        .set('Authorization', 'Bearer user-token')
        .send(orderReq);

      expect(res.status).toBe(500);
      expect(res.body.message).toMatch(/failed to fulfill order/i);
      expect(res.body.followLinkToEndChaos).toBe('http://fail');
    });
  });
});
