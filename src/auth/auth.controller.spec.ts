import { BadRequestException } from '@nestjs/common';

import { AuthController } from './auth.controller';

describe('AuthController', () => {
  const service = {
    login: jest.fn(),
    logout: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    getMe: jest.fn(),
  };

  let controller: AuthController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AuthController(service as never);
  });

  it('login delegates to service and sets cookie', async () => {
    service.login.mockResolvedValue({ token: 'abc', user: { id: 1 } });

    const res = { cookie: jest.fn() };

    await expect(
      controller.login(
        { username: 'u', password: 'p', campId: 1 } as never,
        { ip: '1.1.1.1' } as never,
        res as never,
      ),
    ).resolves.toEqual({
      success: true,
      data: { user: { id: 1 } },
    });

    expect(service.login).toHaveBeenCalledWith(
      { username: 'u', password: 'p', campId: 1 },
      '1.1.1.1',
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'auth_token',
      'abc',
      expect.objectContaining({ path: '/' }),
    );
  });

  it('logout throws when auth_token cookie is missing', async () => {
    await expect(controller.logout({ cookies: {} } as never, { clearCookie: jest.fn() } as never)).rejects.toThrow(BadRequestException);
  });

  it('logout throws when cookie token is empty', async () => {
    await expect(
      controller.logout({ cookies: { auth_token: '' } } as never, { clearCookie: jest.fn() } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('logout uses refreshedToken over cookie token and clears cookie', async () => {
    const res = { clearCookie: jest.fn() };
    
    await expect(
      controller.logout({
        cookies: { auth_token: 'from-cookie' },
        refreshedToken: 'from-refresh',
        ip: '2.2.2.2',
      } as never, res as never),
    ).resolves.toEqual({
      success: true,
      message: 'Logged out successfully',
    });

    expect(service.logout).toHaveBeenCalledWith('from-refresh', '2.2.2.2');
    expect(res.clearCookie).toHaveBeenCalledWith(
      'auth_token',
      expect.objectContaining({ path: '/' }),
    );
  });

  it('checkSession returns active status payload', async () => {
    await expect(controller.checkSession()).resolves.toEqual({
      success: true,
      data: {
        active: true,
      },
    });
  });

  it('forgotPassword always returns generic success message', async () => {
    await expect(
      controller.forgotPassword(
        { username: 'user1', email: 'a@a.com', campId: 4 } as never,
        { ip: '3.3.3.3' } as never,
      ),
    ).resolves.toEqual({
      success: true,
      message:
        'Si el correo pertenece a un usuario registrado, recibiras instrucciones para restablecer la contrasena.',
    });

    expect(service.forgotPassword).toHaveBeenCalledWith('user1', 'a@a.com', 4, '3.3.3.3');
  });

  it('resetPassword returns success message', async () => {
    await expect(
      controller.resetPassword(
        {
          username: 'user1',
          email: 'a@a.com',
          campId: 4,
          code: '12345678',
          newPassword: 'Abc12345!',
        } as never,
        { ip: '4.4.4.4' } as never,
      ),
    ).resolves.toEqual({
      success: true,
      message: 'Contrasena actualizada correctamente',
    });

    expect(service.resetPassword).toHaveBeenCalledWith(
      'user1',
      'a@a.com',
      4,
      '12345678',
      'Abc12345!',
      '4.4.4.4',
    );
  });

  it('getMe delegates to service and wraps payload', async () => {
    service.getMe.mockResolvedValue({ id: 1, username: 'test' });

    await expect(
      controller.getMe({ user: { userId: 123 } } as never),
    ).resolves.toEqual({
      success: true,
      data: { id: 1, username: 'test' },
    });

    expect(service.getMe).toHaveBeenCalledWith(123);
  });
});
