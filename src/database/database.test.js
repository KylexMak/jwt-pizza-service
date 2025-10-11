jest.mock('mysql2/promise', () => ({
  createConnection: jest.fn(),
}));
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-pass'),
  compare: jest.fn().mockResolvedValue(true),
}));

const mysql = require('mysql2/promise');
const { DB, Role } = require('./database.js');
const bcrypt = require('bcrypt');
const config = require('../config.js');

describe('DB Unit Tests', () => {
  let mockConnection;

  beforeEach(() => {
    mockConnection = {
      beginTransaction: jest.fn(),
      rollback: jest.fn(),
      commit: jest.fn(),
      execute: jest.fn(),
      query: jest.fn(),
      end: jest.fn(),
    };
    mysql.createConnection.mockResolvedValue(mockConnection);
    bcrypt.hash.mockResolvedValue('hashed-pass');
    jest.spyOn(DB, 'getID').mockImplementation(async (connection, key, value) => value);
  });

  test('getMenu returns menu items', async () => {
    const menuItems = [{ id: 1, title: 'Veggie', price: 0.0038 }];
    mockConnection.execute.mockResolvedValueOnce([menuItems]);

    const menu = await DB.getMenu();

    expect(mysql.createConnection).toHaveBeenCalled();
    expect(menu).toEqual(menuItems);
    expect(mockConnection.execute).toHaveBeenCalledWith('SELECT * FROM menu', undefined);
    expect(mockConnection.end).toHaveBeenCalled();
  });

  test('addMenuItem adds a menu item', async () => {
    const newItem = { title: 'Student', description: 'No topping', image: 'pizza9.png', price: 0.0001 };
    mockConnection.execute.mockResolvedValueOnce([{ insertId: 2 }]);

    const result = await DB.addMenuItem(newItem);

    expect(mysql.createConnection).toHaveBeenCalled();
    expect(result).toEqual({
        description: 'No topping',
        id: 2,
        image: 'pizza9.png',
        price: 0.0001,
        title: 'Student'
    });

    expect(mockConnection.execute).toHaveBeenCalledWith(
      'INSERT INTO menu (title, description, image, price) VALUES (?, ?, ?, ?)',
      [newItem.title, newItem.description, newItem.image, newItem.price]
    );
    expect(mockConnection.end).toHaveBeenCalled();
  });

  test('addUser creates a new user and returns id', async () => {
    const userData = {
        name: 'Test User',
        email: 'test@testingTest.com',
        password: 'testpass',
        roles: [{ role: 'diner', objectId: 0 }]
    }
    mockConnection.execute.mockResolvedValueOnce([{ insertId: 55 }], [])
    .mockResolvedValueOnce([[]]);

    const user = await DB.addUser(userData);

    expect(bcrypt.hash).toHaveBeenCalledWith('testpass', 10);
    expect(user.id).toBe(55);
    expect(user.password).toBeUndefined();   
  });

  test('getUser returns user and roles', async () => {
    mockConnection.execute.mockResolvedValueOnce([[{ id: 1, email: 'test@example.com', password: 'hashed' }]]);
    mockConnection.execute.mockResolvedValueOnce([[{ role: 'admin', objectId: 0 }]]);

    const user = await DB.getUser('test@example.com', 'password');

    expect(user.email).toBe('test@example.com');
    expect(user.roles[0].role).toBe('admin');
  });

  test('updates password, email, and name, then returns updated user', async () => {
    const userId = 123;
    const name = 'New Name';
    const email = 'newemail@example.com';
    const password = 'newpass';

    mockConnection.execute.mockResolvedValueOnce([{}]);

    const updatedUser = { id: userId, name, email, password: undefined, roles: [] };
    DB.getUser = jest.fn().mockResolvedValue(updatedUser);

    const result = await DB.updateUser(userId, name, email, password);

    expect(bcrypt.hash).toHaveBeenCalledWith(password, 10);

    expect(DB.getUser).toHaveBeenCalledWith(email, password);

    expect(result).toEqual(updatedUser);
  });

  test('lists all users', async () => {
    const usersMock = [
      {id: 1, name: 'Alice', email: 'alice@jwt.com'},
      {id: 2, name: 'Bob', email: 'bob@jwt.com'},
    ]
    const aliceRoles = [{ role: 'diner'}];
    const bobRoles = [{ role: 'admin'}, {role: 'franchisee'}];

    mockConnection.execute.mockResolvedValueOnce([usersMock, []])
    .mockResolvedValueOnce([aliceRoles, []])
    .mockResolvedValueOnce([bobRoles, []]);

    const result = await DB.listAllUsers();

    expect(result[0]).toHaveLength(2);
    expect(result).toEqual([[
        { ...usersMock[0], roles: aliceRoles },
        { ...usersMock[1], roles: bobRoles },
      ], false,
    ]);
    expect(mockConnection.end).toHaveBeenCalled();
  });

  test('does not update if no fields changed; calls getUser anyway', async () => {
    const userId = 123;

    // No update query expected, so mock no calls to execute after DB.getUser mocked
    DB.getUser = jest.fn().mockResolvedValue({ id: userId, name: '', email: '', password: undefined, roles: [] });

    const result = await DB.updateUser(userId);

    expect(mockConnection.execute).not.toHaveBeenCalled();
    expect(DB.getUser).toHaveBeenCalled();
    expect(result.id).toBe(userId);
    expect(mockConnection.end).toHaveBeenCalled();
  });

  test('inserts token and userId into auth table', async () => {
    const rawToken = 'header.payload.signature';
    const expectedTokenSignature = 'signature'; 

    mockConnection.execute.mockResolvedValueOnce([{}]);

    await DB.loginUser(42, rawToken);

    expect(mockConnection.execute).toHaveBeenCalledWith(
      `INSERT INTO auth (token, userId) VALUES (?, ?) ON DUPLICATE KEY UPDATE token=token`,
      [expectedTokenSignature, 42]
    );

    expect(mockConnection.end).toHaveBeenCalled();
  });

  test('returns true if token found', async () => {
    const tokenRaw = 'header.payload.signature';
    const tokenSignature = 'signature';

    // Mock query to return non-empty userId array
    mockConnection.execute.mockResolvedValueOnce([[{ userId: 1 }]]);

    const result = await DB.isLoggedIn(tokenRaw);

    expect(mockConnection.execute).toHaveBeenCalledWith(
      `SELECT userId FROM auth WHERE token=?`,
      [tokenSignature]
    );
    expect(result).toBe(true);
    expect(mockConnection.end).toHaveBeenCalled();
  });

  test('returns false if token not found', async () => {
    const tokenRaw = 'header.payload.signature';
    const tokenSignature = 'signature';

    // Mock query to return empty array
    mockConnection.execute.mockResolvedValueOnce([[]]);

    const result = await DB.isLoggedIn(tokenRaw);

    expect(mockConnection.execute).toHaveBeenCalledWith(
      `SELECT userId FROM auth WHERE token=?`,
      [tokenSignature]
    );
    expect(result).toBe(false);
    expect(mockConnection.end).toHaveBeenCalled();
  });

  test('deletes auth token', async () => {
    const tokenRaw = 'header.payload.signature';
    const tokenSignature = 'signature';

    mockConnection.execute.mockResolvedValueOnce([{}]);

    await DB.logoutUser(tokenRaw);

    expect(mockConnection.execute).toHaveBeenCalledWith(
      `DELETE FROM auth WHERE token=?`,
      [tokenSignature]
    );
    expect(mockConnection.end).toHaveBeenCalled();
  });

  test('returns orders with their items paginated', async () => {
    const user = { id: 10 };
    const page = 1;
    const listPerPage = config.db.listPerPage;

    const offset = (page - 1) * listPerPage;

    const ordersMock = [
      { id: 100, franchiseId: 1, storeId: 1, date: '2025-09-29' },
      { id: 101, franchiseId: 1, storeId: 2, date: '2025-09-28' },
    ];
    mockConnection.execute.mockResolvedValueOnce([ordersMock, []]);

    const itemsForOrder100 = [
      { id: 1, menuId: 10, description: 'Pizza', price: 9.99 },
      { id: 2, menuId: 11, description: 'Drink', price: 1.99 },
    ];
    const itemsForOrder101 = [
      { id: 3, menuId: 12, description: 'Salad', price: 4.99 },
    ];

    mockConnection.execute.mockResolvedValueOnce([itemsForOrder100, []]);
    mockConnection.execute.mockResolvedValueOnce([itemsForOrder101, []]);

    const result = await DB.getOrders(user, page);

    expect(mockConnection.execute).toHaveBeenNthCalledWith(
      1,
      `SELECT id, franchiseId, storeId, date FROM dinerOrder WHERE dinerId=? LIMIT ${offset},${listPerPage}`,
      [user.id]
    );

    expect(mockConnection.execute).toHaveBeenNthCalledWith(
      2,
      `SELECT id, menuId, description, price FROM orderItem WHERE orderId=?`,
      [ordersMock[0].id]
    );
    expect(mockConnection.execute).toHaveBeenNthCalledWith(
      3,
      `SELECT id, menuId, description, price FROM orderItem WHERE orderId=?`,
      [ordersMock[1].id]
    );

    expect(result).toEqual({
      dinerId: user.id,
      page: page,
      orders: [
        { ...ordersMock[0], items: itemsForOrder100 },
        { ...ordersMock[1], items: itemsForOrder101 },
      ],
    });
  });

  test('returns orders with nested items', async () => {
    const user = { id: 1 };
    const page = 1;
    const offset = (page - 1) * config.db.listPerPage;
    const listPerPage = config.db.listPerPage;

    // Mock orders returned by first query
    const orders = [
      { id: 10, franchiseId: 2, storeId: 3, date: '2025-09-29' },
      { id: 11, franchiseId: 2, storeId: 4, date: '2025-09-28' },
    ];
    mockConnection.execute.mockResolvedValueOnce([orders, []]);

    // Mock items for each order
    const items1 = [{ id: 1, menuId: 5, description: 'Pizza', price: 15.0 }];
    const items2 = [{ id: 2, menuId: 6, description: 'Drink', price: 3.0 }];

    mockConnection.execute.mockResolvedValueOnce([items1, []]);
    mockConnection.execute.mockResolvedValueOnce([items2, []]);

    const result = await DB.getOrders(user, page);

    expect(mockConnection.execute).toHaveBeenNthCalledWith(
      1,
      `SELECT id, franchiseId, storeId, date FROM dinerOrder WHERE dinerId=? LIMIT ${offset},${listPerPage}`,
      [user.id]
    );

    expect(mockConnection.execute).toHaveBeenNthCalledWith(
      2,
      `SELECT id, menuId, description, price FROM orderItem WHERE orderId=?`,
      [orders[0].id]
    );

    expect(mockConnection.execute).toHaveBeenNthCalledWith(
      3,
      `SELECT id, menuId, description, price FROM orderItem WHERE orderId=?`,
      [orders[1].id]
    );

    expect(result).toEqual({
      dinerId: user.id,
      page: 1,
      orders: [
        { ...orders[0], items: items1 },
        { ...orders[1], items: items2 },
      ]
    });
  });


  test('inserts an order and order items correctly', async () => {
    const user = { id: 1 };
    const order = {
      franchiseId: 1,
      storeId: 2,
      items: [
        { menuId: 10, description: 'Burger', price: 5.99 },
        { menuId: 11, description: 'Fries', price: 2.99 },
      ],
    };

    mockConnection.execute.mockResolvedValueOnce([{ insertId: 123 }, []]);
    mockConnection.execute.mockResolvedValue([[10]]);
    mockConnection.execute.mockResolvedValue([[11]]);

    const result = await DB.addDinerOrder(user, order);

    expect(mockConnection.execute).toHaveBeenCalledWith(
      'INSERT INTO dinerOrder (dinerId, franchiseId, storeId, date) VALUES (?, ?, ?, now())',
      [user.id, order.franchiseId, order.storeId]
    );

    expect(DB.getID).toHaveBeenNthCalledWith(1, mockConnection, 'id', 10, 'menu');
    expect(DB.getID).toHaveBeenNthCalledWith(2, mockConnection, 'id', 11, 'menu');

    expect(mockConnection.execute).toHaveBeenCalledWith(
      'INSERT INTO orderItem (orderId, menuId, description, price) VALUES (?, ?, ?, ?)',
      [123, 10, 'Burger', 5.99]
    );

    expect(mockConnection.execute).toHaveBeenCalledWith(
      'INSERT INTO orderItem (orderId, menuId, description, price) VALUES (?, ?, ?, ?)',
      [123, 11, 'Fries', 2.99]
    );

    expect(result).toEqual({ ...order, id: 123 });
    expect(mockConnection.end).toHaveBeenCalled();
  });

  test('creates franchise and assigns admins successfully', async () => {
    const franchise = {
      name: 'Test Franchise',
      admins: [
        { email: 'admin1@example.com' },
        { email: 'admin2@example.com' },
      ],
    };

    mockConnection.execute
      .mockResolvedValueOnce([[{ id: 1, name: 'Admin One' }], []])
      .mockResolvedValueOnce([[{ id: 2, name: 'Admin Two' }], []]);

    mockConnection.execute.mockResolvedValueOnce([{ insertId: 99 }, []]);

    mockConnection.execute.mockResolvedValue([]);

    const result = await DB.createFranchise(franchise);

    expect(mockConnection.execute).toHaveBeenNthCalledWith(
      1,
      'SELECT id, name FROM user WHERE email=?',
      ['admin1@example.com']
    );
    expect(mockConnection.execute).toHaveBeenNthCalledWith(
      2,
      'SELECT id, name FROM user WHERE email=?',
      ['admin2@example.com']
    );

    expect(mockConnection.execute).toHaveBeenNthCalledWith(
      3,
      'INSERT INTO franchise (name) VALUES (?)',
      [franchise.name]
    );

    expect(mockConnection.execute).toHaveBeenNthCalledWith(
      4,
      'INSERT INTO userRole (userId, role, objectId) VALUES (?, ?, ?)',
      [1, Role.Franchisee, 99]
    );
    expect(mockConnection.execute).toHaveBeenNthCalledWith(
      5,
      'INSERT INTO userRole (userId, role, objectId) VALUES (?, ?, ?)',
      [2, Role.Franchisee, 99]
    );

    expect(result.id).toBe(99);
    expect(result.admins[0].id).toBe(1);
    expect(result.admins[0].name).toBe('Admin One');
    expect(result.admins[1].id).toBe(2);
    expect(result.admins[1].name).toBe('Admin Two');

    expect(mockConnection.end).toHaveBeenCalled();
  });
  
  test('successfully deletes franchise and commits transaction', async () => {
    const franchiseId = 42;

    // No errors on any query
    mockConnection.execute.mockResolvedValue([{}]);

    await DB.deleteFranchise(franchiseId);

    // Transaction flow
    expect(mockConnection.beginTransaction).toHaveBeenCalled();
    expect(mockConnection.execute).toHaveBeenNthCalledWith(
      1,
      'DELETE FROM store WHERE franchiseId=?',
      [franchiseId]
    );
    expect(mockConnection.execute).toHaveBeenNthCalledWith(
      2,
      'DELETE FROM userRole WHERE objectId=?',
      [franchiseId]
    );
    expect(mockConnection.execute).toHaveBeenNthCalledWith(
      3,
      'DELETE FROM franchise WHERE id=?',
      [franchiseId]
    );
    expect(mockConnection.commit).toHaveBeenCalled();
    expect(mockConnection.rollback).not.toHaveBeenCalled();
    expect(mockConnection.end).toHaveBeenCalled();
  });

  test('returns franchises with stores for non-admin user', async () => {
    const authUser = {
      isRole: (role) => role !== Role.Admin
    };

    const franchisesMock = [
      { id: 1, name: 'Franchise A' },
      { id: 2, name: 'Franchise B' },
      { id: 3, name: 'Franchise C' },
    ];

    // More is true if more than limit (limit = 2 here)
    const limit = 2;
    mockConnection.execute
    .mockResolvedValueOnce([franchisesMock, []])  // 1st query: franchise list
    .mockResolvedValueOnce([[{ id: 101, name: 'Store 1' }], []])  // 2nd query: stores for franchise 1
    .mockResolvedValueOnce([[{ id: 102, name: 'Store 2' }, { id: 103, name: 'Store 3' }], []])  // 3rd: stores for franchise 2
    .mockResolvedValueOnce([[], []]);  // 4th: stores for franchise 3 (empty)


    // Mock store lists per franchise
    mockConnection.execute.mockImplementation(({ 0: query, 1: params }) => {
      if (query.includes('FROM store')) {
        const franchiseId = params[0];
        if (franchiseId === 1)
          return Promise.resolve([[{ id: 101, name: 'Store 1' }], []]);
        if (franchiseId === 2)
          return Promise.resolve([[{ id: 102, name: 'Store 2' }, { id: 103, name: 'Store 3' }], []]);
        return Promise.resolve([[], []]);
      }
      return Promise.resolve([[], []]);
    });

    const [franchises, more] = await DB.getFranchises(authUser, 0, limit, '*');

    expect(mockConnection.execute).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id, name FROM franchise'),
      ['%']
    );

    expect(franchises).toHaveLength(limit);
    expect(more).toBe(true);

    // Each franchise should have 'stores' property with queried stores
    expect(franchises[0].stores).toEqual([{ id: 101, name: 'Store 1' }]);
    expect(franchises[1].stores).toEqual([{ id: 102, name: 'Store 2' }, { id: 103, name: 'Store 3' }]);

    expect(mockConnection.end).toHaveBeenCalled();
  });

  test('returns enriched franchises if franchises found', async () => {
    const userId = 456;
    const franchiseIdsMock = [{ objectId: 5 }, { objectId: 7 }];

    const franchisesMock = [
      { id: 5, name: 'Franchise A' },
      { id: 7, name: 'Franchise B' },
    ];

    mockConnection.execute
      .mockResolvedValueOnce([franchiseIdsMock, []]) // userRole objectIds
      .mockResolvedValueOnce([franchisesMock, []]); // franchise rows

    // Spy on getFranchise to mark franchises as enriched
    const getFranchiseSpy = jest.spyOn(DB, 'getFranchise').mockImplementation(async (franchise) => {
      franchise.enriched = true;
      return franchise;
    });

    const result = await DB.getUserFranchises(userId);

    expect(mockConnection.execute).toHaveBeenNthCalledWith(1,
      `SELECT objectId FROM userRole WHERE role='franchisee' AND userId=?`,
      [userId]
    );
    expect(mockConnection.execute).toHaveBeenNthCalledWith(2,
      `SELECT id, name FROM franchise WHERE id in (5,7)`,
      undefined
    );

    // getFranchise called on both returned franchises
    expect(getFranchiseSpy).toHaveBeenCalledTimes(franchisesMock.length);
    for (const franchise of result) {
      expect(franchise.enriched).toBe(true);
    }

    expect(result).toEqual(franchisesMock);
    expect(mockConnection.end).toHaveBeenCalled();

    getFranchiseSpy.mockRestore();
  });

  test('returns empty array if no franchises found', async () => {
    const userId = 123;

    mockConnection.execute.mockResolvedValueOnce([[], []]); // No userRole matches

    const result = await DB.getUserFranchises(userId);

    expect(mockConnection.execute).toHaveBeenCalledWith(
      `SELECT objectId FROM userRole WHERE role='franchisee' AND userId=?`,
      [userId]
    );
    expect(result).toEqual([]);
    expect(mockConnection.end).toHaveBeenCalled();
  });

  test('get franchise with admins and stores correctly', async () => {
    const franchise = { id: 50, name: 'Test Franchise' };

    const adminsMock = [
      { id: 1, name: 'Admin One', email: 'admin1@example.com' },
      { id: 2, name: 'Admin Two', email: 'admin2@example.com' },
    ];

    const storesMock = [
      { id: 10, name: 'Store A', totalRevenue: 1000.0 },
      { id: 11, name: 'Store B', totalRevenue: 500.5 },
    ];

    // Mock queries in order: admins then stores
    mockConnection.execute
      .mockResolvedValueOnce([adminsMock, []])
      .mockResolvedValueOnce([storesMock, []]);

    const result = await DB.getFranchise(franchise);

    expect(mockConnection.execute).toHaveBeenNthCalledWith(
      1,
      `SELECT u.id, u.name, u.email FROM userRole AS ur JOIN user AS u ON u.id=ur.userId WHERE ur.objectId=? AND ur.role='franchisee'`,
      [franchise.id]
    );
    expect(mockConnection.execute).toHaveBeenNthCalledWith(
      2,
      `SELECT s.id, s.name, COALESCE(SUM(oi.price), 0) AS totalRevenue FROM dinerOrder AS do JOIN orderItem AS oi ON do.id=oi.orderId RIGHT JOIN store AS s ON s.id=do.storeId WHERE s.franchiseId=? GROUP BY s.id`,
      [franchise.id]
    );

    // Verify franchise is enriched with admins and stores arrays
    expect(result.admins).toEqual(adminsMock);
    expect(result.stores).toEqual(storesMock);
    expect(result).toBe(franchise);  // same object reference

    expect(mockConnection.end).toHaveBeenCalled();
  });

  test('inserts a store and returns the created store info', async () => {
    const franchiseId = 10;
    const store = { name: 'New Store' };

    // Mock insert result to include insertId as new store ID
    mockConnection.execute.mockResolvedValue([{ insertId: 123 }, []]);

    const result = await DB.createStore(franchiseId, store);

    expect(mockConnection.execute).toHaveBeenCalledWith(
      'INSERT INTO store (franchiseId, name) VALUES (?, ?)',
      [franchiseId, store.name]
    );

    expect(result).toEqual({
      id: 123,
      franchiseId: franchiseId,
      name: store.name,
    });

    expect(mockConnection.end).toHaveBeenCalled();
  });

  test('deletes the store with given franchiseId and storeId', async () => {
    const franchiseId = 5;
    const storeId = 10;

    mockConnection.execute.mockResolvedValue([{}]);

    await DB.deleteStore(franchiseId, storeId);

    expect(mockConnection.execute).toHaveBeenCalledWith(
      'DELETE FROM store WHERE franchiseId=? AND id=?',
      [franchiseId, storeId]
    );

    expect(mockConnection.end).toHaveBeenCalled();
  });
});
