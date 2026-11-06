import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddBotIntegrationTables1787300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create otp_codes table
    await queryRunner.createTable(
      new Table({
        name: 'otp_codes',
        columns: [
          {
            name: 'id',
            type: 'text',
            isPrimary: true,
          },
          {
            name: 'phoneNumber',
            type: 'varchar',
            length: '20',
          },
          {
            name: 'code',
            type: 'varchar',
            length: '4',
          },
          {
            name: 'verified',
            type: 'boolean',
            default: 0,
          },
          {
            name: 'expiresAt',
            type: 'datetime',
          },
          {
            name: 'createdAt',
            type: 'datetime',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'otp_codes',
      new TableIndex({
        name: 'IDX_otp_codes_phoneNumber',
        columnNames: ['phoneNumber'],
      }),
    );

    // Create booking_sync table
    await queryRunner.createTable(
      new Table({
        name: 'booking_sync',
        columns: [
          {
            name: 'id',
            type: 'text',
            isPrimary: true,
          },
          {
            name: 'vercelBookingId',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'phoneNumber',
            type: 'varchar',
            length: '20',
          },
          {
            name: 'customerName',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'service',
            type: 'varchar',
            length: '100',
          },
          {
            name: 'appointmentDate',
            type: 'date',
          },
          {
            name: 'appointmentTime',
            type: 'time',
          },
          {
            name: 'status',
            type: 'varchar',
            length: '50',
            default: "'pending'",
          },
          {
            name: 'reminderSent',
            type: 'boolean',
            default: 0,
          },
          {
            name: 'reminderSentAt',
            type: 'datetime',
            isNullable: true,
          },
          {
            name: 'customerResponseAt',
            type: 'datetime',
            isNullable: true,
          },
          {
            name: 'customerResponse',
            type: 'varchar',
            length: '10',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'datetime',
          },
          {
            name: 'updatedAt',
            type: 'datetime',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'booking_sync',
      new TableIndex({
        name: 'IDX_booking_sync_vercelBookingId',
        columnNames: ['vercelBookingId'],
      }),
    );

    await queryRunner.createIndex(
      'booking_sync',
      new TableIndex({
        name: 'IDX_booking_sync_phoneNumber',
        columnNames: ['phoneNumber'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('booking_sync', 'IDX_booking_sync_phoneNumber');
    await queryRunner.dropIndex('booking_sync', 'IDX_booking_sync_vercelBookingId');
    await queryRunner.dropTable('booking_sync');
    await queryRunner.dropIndex('otp_codes', 'IDX_otp_codes_phoneNumber');
    await queryRunner.dropTable('otp_codes');
  }
}
